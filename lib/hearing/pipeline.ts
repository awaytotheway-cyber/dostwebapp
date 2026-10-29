import { t as translate } from '../i18n';
import { supabase } from '../supabase';
import { extractAcousticFeatures } from './acousticFeatures';
import type { AcousticFeatures } from './acousticFeatures';
import { inferAcousticState } from './acousticInference';
import {
  logCalibrationRow,
  shouldLogCalibration,
} from './calibration';
import { getEnrollmentLanguages, loadSpeakerProfile, type SpeakerProfile } from './enrollment';
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
import { summariseSignals, type VoiceSignalRow } from './sessionSummary';
import { getSensitivity } from './sensitivity';
import { cosineSimilarity, embedSpeech, releaseSpeakerModel, speechStats } from './speakerEmbedding';
import { analyzeVoiceprint } from './speakerFingerprint';
import {
  verifyNeural,
  verifySpeaker,
  type Sensitivity,
  type VerificationOutcome,
} from './speakerVerification';
import {
  disposeTranscription,
  getCloudTranscription,
  transcribeSegment,
  type TranscriptionOptions,
} from './transcription';

/**
 * Full hearing pipeline.
 *
 * Session start
 *   → create voice_sessions row
 *   → start the native foreground service
 *   → subscribe to native events
 *
 * For each VAD-detected speech segment (queued, processed one at a time):
 *   → speaker gate: neural embedding vs the enrolled reference (MFCC
 *     voiceprint on devices that can't run the model). A long segment
 *     that doesn't match as a whole — two people taking turns — is
 *     re-scored in 1.5 s windows and only the user's windows are kept.
 *   → extract acoustic features (real signal processing)
 *   → transcribe: cloud if the user opted in, else on-device Whisper
 *     (both fail soft)
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
 * Battery modes only change how much work may wait: the queue holds
 * 8 / 4 / 2 segments (attentive / balanced / light) and light mode skips
 * the windowed re-scoring. When the queue is full the oldest waiting
 * segment is dropped, so speech is never skipped while the phone idles.
 *
 * Memory hygiene: PCM buffers are local to the queue and processSegment().
 * Nothing accumulates across the session — queued segments are processed
 * then zeroed, not aggregated.
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

const QUEUE_LIMIT: Record<BatteryMode, number> = {
  attentive: 8,
  balanced: 4,
  light: 2,
};

// Windowed re-scoring for segments that don't match as a whole.
const SPLIT_MIN_SECONDS = 3;
const SPLIT_WINDOW_SECONDS = 1.5;
const SPLIT_HOP_SECONDS = 0.75;
const SPLIT_MAX_WINDOWS = 40;
const SPLIT_MIN_KEPT_SECONDS = 1;

type SessionCtx = {
  sessionId: string;
  userId: string;
  batteryMode: BatteryMode;
  sensitivity: Sensitivity;
  profile: SpeakerProfile;
  transcription: TranscriptionOptions;
  startedAt: number;
  segmentsProcessed: number;
  queue: HearingSpeechSegment[];
  draining: boolean;
  stopped: boolean;
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
  const transcription = await transcriptionOptions();

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
      enqueueSegment(ctx, seg);
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
    profile,
    transcription,
    startedAt,
    segmentsProcessed: 0,
    queue: [],
    draining: false,
    stopped: false,
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

  // Give queued and in-flight segments a brief chance to finish so their
  // rows land before we write the session summary; then drop the rest.
  await waitFor(() => !active.draining && active.queue.length === 0, 8000);
  active.stopped = true;
  clearQueue(active);
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

  // Phase 3: fold this session's signals into the one row DOST reads.
  await writeListeningSummary(active, endedAt, totalMs, speechMs);

  active.unsubscribe();
  ctx = null;
  setState({ status: 'idle' });
}

/**
 * Writes the per-session listening_summaries row (Phase 3).
 *
 * Reads the signals back rather than accumulating them in memory, so
 * segments finished by background tasks are included and nothing has to
 * be held across the session.
 *
 * Fail-open: the session itself is already saved, so a failure here only
 * costs DOST this session's context. Never throws into session stop.
 */
async function writeListeningSummary(
  active: SessionCtx,
  endedAt: number,
  totalMs: number,
  speechMs: number,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('voice_signals')
      .select(
        'rms_energy, pitch_mean_hz, pitch_variability, speaking_rate_wpm, silence_ratio, ' +
          'vocal_stress_index, primary_emotion, secondary_emotions, underlying_need, ' +
          'acoustic_arousal, acoustic_valence, inference_source',
      )
      .eq('session_id', active.sessionId);

    if (error || !Array.isArray(data)) return;
    // Nothing was captured (all silence, or every segment another voice) —
    // an empty summary would only add noise to the nightly synthesis.
    if (data.length === 0) return;

    const summary = summariseSignals(data as unknown as VoiceSignalRow[], {
      startedAt: active.startedAt,
      endedAt,
      totalSeconds: totalMs / 1000,
      speechSeconds: speechMs / 1000,
      totalSegments:
        active.segmentsMatched +
        active.segmentsDiscardedOtherSpeaker +
        active.segmentsDiscardedAmbiguous,
      matchedSegments: active.segmentsMatched,
    });

    await supabase.from('listening_summaries').upsert(
      { user_id: active.userId, session_id: active.sessionId, ...summary },
      { onConflict: 'session_id' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[hearing] listening summary failed:', err);
  }
}

async function abortSession(reason: string): Promise<void> {
  const active = ctx;
  if (!active) return;
  try { active.unsubscribe(); } catch {}
  active.stopped = true;
  clearQueue(active);
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

// ─── queue + speaker gate ─────────────────────────────────────────

function enqueueSegment(active: SessionCtx, seg: HearingSpeechSegment): void {
  if (active.stopped) {
    seg.pcm.fill(0);
    return;
  }
  const limit = QUEUE_LIMIT[active.batteryMode];
  while (active.queue.length >= limit) {
    active.queue.shift()?.pcm.fill(0);
  }
  active.queue.push(seg);
  publishPending();
  void drainQueue(active);
}

function clearQueue(active: SessionCtx): void {
  for (const seg of active.queue) seg.pcm.fill(0);
  active.queue = [];
}

async function drainQueue(active: SessionCtx): Promise<void> {
  if (active.draining) return;
  active.draining = true;
  try {
    while (!active.stopped && active.queue.length > 0) {
      const seg = active.queue.shift()!;
      publishPending();
      try {
        await handleSegment(active, seg);
      } catch (err) {
        seg.pcm.fill(0);
        if (__DEV__) console.warn('[hearing] segment failed:', err);
      }
    }
  } finally {
    active.draining = false;
    publishPending();
  }
}

async function handleSegment(active: SessionCtx, seg: HearingSpeechSegment): Promise<void> {
  // ─── Phase 2 speaker gate ──────────────────────────────────
  // On match: proceed with only the user's audio. On mismatch or
  // ambiguous: drop the segment without any downstream processing
  // (no acoustic features, no transcription, no DB insert). Rule 5.
  const gate = await gateSegment(active, seg);

  // Time-boxed calibration logging (Step 8). Fire-and-forget; never
  // awaited, never surfaces errors. Bounded by
  // calibrationRowsRemaining so we can't over-write the per-user cap.
  if (active.calibrationRowsRemaining > 0) {
    logCalibrationRow(active.userId, gate.outcome.similarity, gate.outcome.result, active.sensitivity);
    active.calibrationRowsRemaining--;
  }

  if (gate.outcome.result !== 'match' || !gate.pcm) {
    if (gate.outcome.result === 'mismatch') {
      active.segmentsDiscardedOtherSpeaker++;
    } else {
      active.segmentsDiscardedAmbiguous++;
    }
    seg.pcm.fill(0);
    publishCounters();
    return;
  }

  active.segmentsMatched++;
  publishCounters();
  const kept = gate.pcm;
  if (kept !== seg.pcm) seg.pcm.fill(0);
  await processSegment(active, {
    ...seg,
    pcm: kept,
    durationMs: (kept.length / seg.sampleRate) * 1000,
  });
}

type GateResult = { outcome: VerificationOutcome; pcm: Float32Array | null };

async function gateSegment(active: SessionCtx, seg: HearingSpeechSegment): Promise<GateResult> {
  const { profile } = active;
  if (profile.engine === 'mfcc') {
    const outcome = verifySpeaker(
      analyzeVoiceprint(seg.pcm, seg.sampleRate),
      profile.reference,
      profile.calibration,
      active.sensitivity,
    );
    return { outcome, pcm: outcome.result === 'match' ? seg.pcm : null };
  }

  const whole = await scoreNeural(active, seg.pcm, seg.sampleRate);
  const seconds = seg.pcm.length / seg.sampleRate;
  if (active.batteryMode === 'light' || seconds < SPLIT_MIN_SECONDS) {
    return { outcome: whole, pcm: whole.result === 'match' ? seg.pcm : null };
  }
  // Long segments are re-scored in windows either way: a match as a
  // whole can still carry another person's turn (the user's half
  // dominates the average), and a non-match can still hold the user's.
  return splitByWindows(active, seg, whole);
}

async function scoreNeural(
  active: SessionCtx,
  pcm: Float32Array,
  sampleRate: number,
): Promise<VerificationOutcome> {
  if (active.profile.engine !== 'neural') return { result: 'ambiguous', similarity: 0 };
  const stats = speechStats(pcm, sampleRate);
  const embedding = await embedSpeech(pcm, sampleRate);
  if (!embedding) return { result: 'ambiguous', similarity: 0 };
  return verifyNeural(
    cosineSimilarity(embedding, active.profile.reference),
    stats,
    active.profile.calibration,
    active.sensitivity,
  );
}

/**
 * Two people taking turns inside one VAD segment average out to a score
 * that is neither person. Re-score short windows and stitch the user's
 * audio back together. When the whole segment matched, only windows that
 * are clearly someone else are cut (borderline windows are usually the
 * user in noise); when it didn't, only clear matches are kept.
 */
async function splitByWindows(
  active: SessionCtx,
  seg: HearingSpeechSegment,
  whole: VerificationOutcome,
): Promise<GateResult> {
  const sr = seg.sampleRate;
  const win = Math.round(SPLIT_WINDOW_SECONDS * sr);
  const hop = Math.round(SPLIT_HOP_SECONDS * sr);
  const ranges: Array<[number, number]> = [];
  let best = whole.similarity;
  let windows = 0;
  for (let start = 0; start + win <= seg.pcm.length && windows < SPLIT_MAX_WINDOWS; start += hop) {
    windows++;
    const outcome = await scoreNeural(active, seg.pcm.subarray(start, start + win), sr);
    const keep = whole.result === 'match' ? outcome.result !== 'mismatch' : outcome.result === 'match';
    if (!keep) continue;
    if (outcome.result === 'match') best = Math.max(best, outcome.similarity);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = start + win;
    else ranges.push([start, start + win]);
  }
  const keptSamples = ranges.reduce((n, [a, b]) => n + (b - a), 0);
  if (keptSamples < SPLIT_MIN_KEPT_SECONDS * sr) {
    return {
      outcome: whole.result === 'match' ? { result: 'ambiguous', similarity: whole.similarity } : whole,
      pcm: null,
    };
  }

  const kept = new Float32Array(keptSamples);
  let offset = 0;
  for (const [a, b] of ranges) {
    kept.set(seg.pcm.subarray(a, b), offset);
    offset += b - a;
  }
  return { outcome: { result: 'match', similarity: best }, pcm: kept };
}

async function transcriptionOptions(): Promise<TranscriptionOptions> {
  const [cloud, languages] = await Promise.all([
    getCloudTranscription(),
    getEnrollmentLanguages(),
  ]);
  // A single spoken language is a strong hint; with several, let the
  // recogniser detect per segment.
  return { cloud, language: languages.length === 1 ? languages[0] : undefined };
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

    // 2. Transcription — cloud if opted in, else on-device. Fails soft, returns ''.
    transcript = await transcribeSegment(pcm, seg.sampleRate, active.transcription);

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
  setState({
    ...state,
    segmentsPending: ctx.queue.length + (ctx.draining ? 1 : 0),
  });
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
  await releaseSpeakerModel();
}
