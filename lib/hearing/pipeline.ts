import { t as translate } from '../i18n';
import { supabase } from '../supabase';
import { extractAcousticFeatures } from './acousticFeatures';
import type { AcousticFeatures } from './acousticFeatures';
import { inferAcousticState } from './acousticInference';
import {
  logCalibrationRow,
  shouldLogCalibration,
} from './calibration';
import { loadSpeakerProfile } from './enrollment';
import {
  isSessionActive as nativeIsSessionActive,
  startSession as nativeStartSession,
  stopSession as nativeStopSession,
  subscribeHearing,
  type HearingSessionStopped,
  type HearingSpeechSegment,
  type HearingStartError,
  type HearingTick,
} from './hearingBridge';
import { redactPII } from './redaction';
import { getSensitivity } from './sensitivity';
import { analyzeVoiceprint, type Voiceprint } from './speakerFingerprint';
import {
  verifySpeaker,
  type Sensitivity,
  type SpeakerCalibration,
  type VerificationResult,
} from './speakerVerification';
import { disposeTranscription, transcribeSegment } from './transcription';

/**
 * Full hearing pipeline.
 *
 * Session start
 *   → create voice_sessions row
 *   → start the native foreground service
 *   → subscribe to native events
 *
 * For each VAD-detected speech segment:
 *   → extract acoustic features (real signal processing)
 *   → transcribe on-device with Whisper (fails soft)
 *   → redact PII from the transcript
 *   → call hearing-extract-emotions (fails soft)
 *   → compute mock acoustic inference, stamped inference_source='mock'
 *   → insert one voice_signals row
 *   → drop the PCM buffer and transcript from the local scope
 *
 * Session stop
 *   → stop the native service
 *   → update the voice_sessions row with totals
 *
 * Memory hygiene: PCM buffers are local to processSegment(). Nothing
 * accumulates across the session — even in balanced/light modes,
 * queued segments are processed then dropped, not aggregated.
 */

export type BatteryMode = 'attentive' | 'balanced' | 'light';

export type PipelineState =
  | { status: 'idle' }
  | {
      status: 'active';
      sessionId: string;
      userId: string;
      startedAt: number;
      batteryMode: BatteryMode;
      sensitivity: Sensitivity;
      segmentsProcessed: number;
      segmentsPending: number;
      segmentsMatched: number;
      segmentsDiscardedOtherSpeaker: number;
      segmentsDiscardedAmbiguous: number;
      totalMs: number;
      speechMs: number;
      calibrating: boolean;
      lastSpeech: boolean;
      lastRms: number;
    };

type Listener = (state: PipelineState) => void;

const listeners = new Set<Listener>();
let state: PipelineState = { status: 'idle' };

function setState(next: PipelineState) {
  state = next;
  for (const l of listeners) l(state);
}

export function getPipelineState(): PipelineState {
  return state;
}

export function subscribePipeline(cb: Listener): () => void {
  listeners.add(cb);
  cb(state);
  return () => {
    listeners.delete(cb);
  };
}

// ─── session lifecycle ────────────────────────────────────────────

type SessionCtx = {
  sessionId: string;
  userId: string;
  batteryMode: BatteryMode;
  sensitivity: Sensitivity;
  referenceVoiceprint: Voiceprint;
  calibration: SpeakerCalibration;
  startedAt: number;
  segmentsProcessed: number;
  segmentIndex: number; // increments per received segment, for 'light' sampling
  segmentsMatched: number;
  segmentsDiscardedOtherSpeaker: number;
  segmentsDiscardedAmbiguous: number;
  // Calibration logging: decided once at session start. Counts down
  // per row written so we cap without another DB read per segment.
  calibrationRowsRemaining: number;
  activeTasks: number;
  unsubscribe: () => void;
  lastSummary?: HearingSessionStopped;
  lastTickTotalMs: number;
  lastTickSpeechMs: number;
};

let ctx: SessionCtx | null = null;

export async function startHearingSession(
  batteryMode: BatteryMode = 'balanced',
): Promise<void> {
  if (ctx) return; // already running

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error(translate('errors.signInToListen'));
  }
  const userId = userData.user.id;

  // Phase 2 gate prerequisite: fetch the enrolled reference voiceprint
  // once at session start. Sessions cannot run without one — the UI's
  // enrollment gate is the primary defense, this is the safety net.
  const profile = await loadSpeakerProfile();
  if (!profile) {
    throw new Error(translate('errors.enrollFirst'));
  }
  const sensitivity = await getSensitivity();
  const calibrationDecision = await shouldLogCalibration(userId);

  const { data: sessionRow, error: sessErr } = await supabase
    .from('voice_sessions')
    .insert({ user_id: userId, battery_mode: batteryMode })
    .select('id, started_at')
    .single();
  if (sessErr || !sessionRow) {
    throw new Error(`Failed to create voice_sessions row: ${sessErr?.message ?? 'unknown'}`);
  }

  const sessionId = sessionRow.id as string;
  const startedAt = new Date(sessionRow.started_at as string).getTime();

  const unsubscribe = subscribeHearing({
    onSegment: (seg) => {
      if (!ctx) return;
      ctx.segmentIndex++;

      // Battery mode: 'light' processes 1 in 3 segments (sampled coverage).
      // Note: 'light' drops are separate from speaker-gate discards —
      // they don't count as "other speaker" or "ambiguous."
      if (ctx.batteryMode === 'light' && ctx.segmentIndex % 3 !== 1) {
        seg.pcm.fill(0); // release native-backed bytes
        return;
      }

      // Balanced: cap concurrency to 1 (serialize). Attentive: unbounded.
      // A queued segment would grow across the session; drop instead.
      if (ctx.batteryMode === 'balanced' && ctx.activeTasks > 0) {
        seg.pcm.fill(0);
        return;
      }

      // ─── Phase 2 speaker gate ──────────────────────────────────
      // Extract this segment's voiceprint and compare to the enrolled
      // reference. On match: proceed. On mismatch or ambiguous: drop
      // the segment without any downstream processing (no acoustic
      // features, no transcription, no DB insert). Rule 5.
      const segPrint = analyzeVoiceprint(seg.pcm, seg.sampleRate);
      const gate = verifySpeaker(
        segPrint,
        ctx.referenceVoiceprint,
        ctx.calibration,
        ctx.sensitivity,
      );

      // Time-boxed calibration logging (Step 8). Fire-and-forget; never
      // awaited, never surfaces errors. Bounded by
      // ctx.calibrationRowsRemaining so we can't over-write per-user cap.
      if (ctx.calibrationRowsRemaining > 0) {
        logCalibrationRow(
          ctx.userId,
          gate.similarity,
          gate.result,
          ctx.sensitivity,
        );
        ctx.calibrationRowsRemaining--;
      }

      if (gate.result !== 'match') {
        if (gate.result === 'mismatch') {
          ctx.segmentsDiscardedOtherSpeaker++;
        } else {
          ctx.segmentsDiscardedAmbiguous++;
        }
        seg.pcm.fill(0);
        publishCounters();
        return;
      }

      ctx.segmentsMatched++;
      publishCounters();
      void processSegment(ctx, seg);
    },
    onTick: (t) => {
      if (!ctx) return;
      ctx.lastTickTotalMs = t.totalMs;
      ctx.lastTickSpeechMs = t.speechMs;
      if (state.status !== 'active') return;
      setState({
        ...state,
        totalMs: t.totalMs,
        speechMs: t.speechMs,
        calibrating: t.calibrating,
        lastSpeech: t.speech,
        lastRms: t.rms,
      });
    },
    onStopped: (s) => {
      if (ctx) ctx.lastSummary = s;
    },
    onStartError: (e: HearingStartError) => {
      // Native side couldn't start capture. Roll back the session row.
      void abortSession(e.reason).catch(() => {});
    },
  });

  ctx = {
    sessionId,
    userId,
    batteryMode,
    sensitivity,
    referenceVoiceprint: profile.reference,
    calibration: profile.calibration,
    startedAt,
    segmentsProcessed: 0,
    segmentIndex: 0,
    segmentsMatched: 0,
    segmentsDiscardedOtherSpeaker: 0,
    segmentsDiscardedAmbiguous: 0,
    calibrationRowsRemaining: calibrationDecision.shouldLog
      ? calibrationDecision.rowsRemaining
      : 0,
    activeTasks: 0,
    unsubscribe,
    lastTickTotalMs: 0,
    lastTickSpeechMs: 0,
  };

  setState({
    status: 'active',
    sessionId,
    userId,
    startedAt,
    batteryMode,
    sensitivity,
    segmentsProcessed: 0,
    segmentsPending: 0,
    segmentsMatched: 0,
    segmentsDiscardedOtherSpeaker: 0,
    segmentsDiscardedAmbiguous: 0,
    totalMs: 0,
    speechMs: 0,
    calibrating: true,
    lastSpeech: false,
    lastRms: 0,
  });

  try {
    await nativeStartSession();
  } catch (err) {
    ctx.unsubscribe();
    ctx = null;
    setState({ status: 'idle' });
    await supabase.from('voice_sessions').delete().eq('id', sessionId);
    throw err;
  }
}

export async function stopHearingSession(): Promise<void> {
  if (!ctx) return;
  const active = ctx;

  try {
    await nativeStopSession();
  } catch {
    // fall through and still update the DB
  }

  // Give any in-flight tasks a brief chance to finish so their rows land
  // before we write the session summary.
  await waitForTasks(active, 3000);
  // The stop intent is handled asynchronously by the service, so its
  // summary event can land after nativeStopSession() resolves.
  await waitFor(() => active.lastSummary !== undefined, 1500);

  const totalMs = active.lastSummary?.totalMs ?? active.lastTickTotalMs;
  const speechMs = active.lastSummary?.speechMs ?? active.lastTickSpeechMs;
  const endedAt = active.lastSummary?.endedAt ?? Date.now();

  await supabase
    .from('voice_sessions')
    .update({
      ended_at: new Date(endedAt).toISOString(),
      total_duration_seconds: totalMs / 1000,
      speech_duration_seconds: speechMs / 1000,
      segments_processed: active.segmentsProcessed,
      segments_matched: active.segmentsMatched,
      segments_discarded_other_speaker: active.segmentsDiscardedOtherSpeaker,
      segments_discarded_ambiguous: active.segmentsDiscardedAmbiguous,
    })
    .eq('id', active.sessionId);

  active.unsubscribe();
  ctx = null;
  setState({ status: 'idle' });
}

async function abortSession(reason: string): Promise<void> {
  const active = ctx;
  if (!active) return;
  try { active.unsubscribe(); } catch {}
  try { await nativeStopSession(); } catch {}
  await supabase.from('voice_sessions').delete().eq('id', active.sessionId);
  ctx = null;
  setState({ status: 'idle' });
  if (__DEV__) console.warn('[hearing] session aborted:', reason);
}

async function waitForTasks(active: SessionCtx, timeoutMs: number): Promise<void> {
  await waitFor(() => active.activeTasks === 0, timeoutMs);
}

async function waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!done() && Date.now() - start < timeoutMs) {
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── per-segment pipeline ─────────────────────────────────────────

async function processSegment(
  active: SessionCtx,
  seg: HearingSpeechSegment,
): Promise<void> {
  active.activeTasks++;
  publishPending();

  // Locally-scoped references. When this function returns, both go out
  // of scope and become GC-eligible. Explicitly null them below as
  // belt-and-braces for large PCM arrays.
  let pcm: Float32Array | null = seg.pcm;
  let transcript: string | null = null;
  let redacted: string | null = null;

  try {
    const durationSeconds = seg.durationMs / 1000;

    // 1. Acoustic features — real signal processing.
    const features: AcousticFeatures = extractAcousticFeatures(
      pcm,
      seg.sampleRate,
      '', // transcript for WPM added after Whisper below
      durationSeconds,
    );

    // 2. On-device transcription — fails soft, returns ''.
    transcript = await transcribeSegment(pcm);

    // Drop the PCM as soon as Whisper is done with it.
    pcm = null;

    // Recompute speaking_rate_wpm now that we have a word count.
    const withRate: AcousticFeatures = {
      ...features,
      speaking_rate_wpm: computeWpm(transcript, durationSeconds),
    };

    // 3. Redact PII before it leaves the device.
    redacted = redactPII(transcript);
    transcript = null;

    // 4. Semantic emotions from Phase 5 pipeline — fails soft.
    let semantic: SemanticTags | null = null;
    if (redacted && redacted.trim().length > 3) {
      semantic = await extractHearingEmotions(redacted);
    }
    redacted = null;

    // 5. Mock acoustic inference — stamped inference_source='mock'.
    const inference = inferAcousticState(withRate);

    // 6. Insert one voice_signals row.
    await supabase.from('voice_signals').insert({
      user_id: active.userId,
      session_id: active.sessionId,
      captured_at: new Date(seg.capturedAt).toISOString(),
      segment_duration_seconds: durationSeconds,

      rms_energy: withRate.rms_energy,
      pitch_mean_hz: withRate.pitch_mean_hz,
      pitch_variability: withRate.pitch_variability,
      speaking_rate_wpm: withRate.speaking_rate_wpm,
      silence_ratio: withRate.silence_ratio,
      vocal_stress_index: withRate.vocal_stress_index,

      primary_emotion: semantic?.primary_emotion ?? null,
      secondary_emotions: semantic?.secondary_emotions ?? null,
      underlying_need: semantic?.underlying_need ?? null,
      semantic_confidence: semantic?.semantic_confidence ?? null,

      acoustic_arousal: inference.acoustic_arousal,
      acoustic_valence: inference.acoustic_valence,
      inference_source: inference.inference_source,
    });

    active.segmentsProcessed++;
    if (state.status === 'active') {
      setState({ ...state, segmentsProcessed: active.segmentsProcessed });
    }
  } catch (err) {
    if (__DEV__) console.warn('[hearing] segment processing failed:', err);
  } finally {
    // Belt-and-braces: even a thrown exception clears our locals here.
    pcm = null;
    transcript = null;
    redacted = null;
    active.activeTasks--;
    publishPending();
  }
}

function publishPending() {
  if (state.status !== 'active' || !ctx) return;
  setState({ ...state, segmentsPending: ctx.activeTasks });
}

function publishCounters() {
  if (state.status !== 'active' || !ctx) return;
  setState({
    ...state,
    segmentsMatched: ctx.segmentsMatched,
    segmentsDiscardedOtherSpeaker: ctx.segmentsDiscardedOtherSpeaker,
    segmentsDiscardedAmbiguous: ctx.segmentsDiscardedAmbiguous,
  });
}

function computeWpm(text: string, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / durationSeconds) * 60;
}

// ─── semantic emotions leg ────────────────────────────────────────

type SemanticTags = {
  primary_emotion: string;
  secondary_emotions: string[];
  underlying_need: string;
  semantic_confidence: number;
};

async function extractHearingEmotions(text: string): Promise<SemanticTags | null> {
  try {
    const { data, error } = await supabase.functions.invoke<SemanticTags>(
      'hearing-extract-emotions',
      { body: { text } },
    );
    if (error || !data) return null;
    if (typeof data.primary_emotion !== 'string') return null;
    return data;
  } catch (err) {
    if (__DEV__) console.warn('[hearing] extract-emotions failed:', err);
    return null;
  }
}

// ─── convenience passthroughs ─────────────────────────────────────

export async function isSessionActive(): Promise<boolean> {
  return nativeIsSessionActive();
}

/** Release the on-device Whisper model when leaving the feature. */
export async function releaseHearingResources(): Promise<void> {
  await disposeTranscription();
}
