import { supabase } from '../supabase';

/**
 * Hearing Phase 3: write one listening_summaries row per session.
 *
 * Called from stopHearingSession() once the per-segment voice_signals
 * rows have landed. Reads this session's signals back and rolls them
 * up into a single labels-and-numbers summary that DOST's chat
 * function and the nightly consolidation loop can read cheaply,
 * without ever touching per-segment data.
 *
 * ── The mock quarantine ───────────────────────────────────────────
 * voice_signals rows carry inference_source per row. Today every row
 * is 'mock', because acoustic emotion inference is faked (see
 * acousticInference.ts).
 *
 * Only arousal/valence are mock. The semantic tokens and the measured
 * acoustic features in the same row are real, so this writer treats
 * them differently:
 *
 *   • emotion/need counts, wpm, pitch, stress, silence — always
 *     aggregated over every segment. Real data, always summarised.
 *   • arousal/valence — aggregated ONLY over segments whose
 *     inference_source is not 'mock'. If no such segment exists, both
 *     are written as NULL and the row is stamped 'mock'.
 *
 * So a mock-only session produces a summary with real voice content
 * and an explicitly empty acoustic-inference slot. Nothing downstream
 * can mistake a fabricated arousal number for a real one.
 *
 * ── Failure posture ───────────────────────────────────────────────
 * Fail-open and silent. A session that ends without a summary row is
 * a missing aggregate, not a broken session — the per-segment rows
 * are already safely persisted. This function never throws.
 */

const INFERENCE_SOURCE_PRIORITY = ['mock', 'acoustic_v1', 'fused_v1'] as const;
type InferenceSourceValue = (typeof INFERENCE_SOURCE_PRIORITY)[number];

type SignalRow = {
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
  rms_energy: number | null;
  pitch_mean_hz: number | null;
  pitch_variability: number | null;
  speaking_rate_wpm: number | null;
  silence_ratio: number | null;
  vocal_stress_index: number | null;
  acoustic_arousal: number | null;
  acoustic_valence: number | null;
  inference_source: string | null;
};

export type SessionSummaryInput = {
  userId: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  totalMs: number;
  speechMs: number;
  segmentsMatched: number;
};

/**
 * Aggregate one session's voice_signals into a listening_summaries
 * row. Returns true if a row was written, false on any failure.
 */
export async function writeSessionSummary(
  input: SessionSummaryInput,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('voice_signals')
      .select(
        'primary_emotion, secondary_emotions, underlying_need, rms_energy, pitch_mean_hz, pitch_variability, speaking_rate_wpm, silence_ratio, vocal_stress_index, acoustic_arousal, acoustic_valence, inference_source',
      )
      .eq('session_id', input.sessionId);

    if (error) {
      if (__DEV__) console.warn('[hearing] summary read failed:', error.message);
      return false;
    }

    const rows = (data ?? []) as SignalRow[];

    // A session with no persisted segments has nothing to summarise.
    // Writing an empty row would add noise to the chat context for no
    // gain, so skip it.
    if (rows.length === 0) return false;

    const payload = buildSummaryPayload(rows, input);

    // Upsert on session_id: retrying a session stop must be
    // idempotent rather than a duplicate-key error.
    const { error: writeError } = await supabase
      .from('listening_summaries')
      .upsert(payload, { onConflict: 'session_id' });

    if (writeError) {
      if (__DEV__) {
        console.warn('[hearing] summary write failed:', writeError.message);
      }
      return false;
    }

    return true;
  } catch (err) {
    if (__DEV__) console.warn('[hearing] summary failed:', err);
    return false;
  }
}

/**
 * Pure aggregation — split out so it can be reasoned about and tested
 * without a database.
 */
export function buildSummaryPayload(
  rows: SignalRow[],
  input: SessionSummaryInput,
): Record<string, unknown> {
  const emotionCounts = countTokens(
    rows.flatMap((r) => [r.primary_emotion, ...(r.secondary_emotions ?? [])]),
  );
  const needCounts = countTokens(rows.map((r) => r.underlying_need));

  // Real measurements: averaged over every segment.
  const avgRms = meanOf(rows, (r) => r.rms_energy);
  const avgPitch = meanOf(rows, (r) => r.pitch_mean_hz, { positiveOnly: true });
  const avgPitchVar = meanOf(rows, (r) => r.pitch_variability);
  const avgWpm = meanOf(rows, (r) => r.speaking_rate_wpm, {
    positiveOnly: true,
  });
  const avgSilence = meanOf(rows, (r) => r.silence_ratio);
  const avgStress = meanOf(rows, (r) => r.vocal_stress_index);

  // Acoustic inference: averaged ONLY over non-mock segments.
  const realInference = rows.filter(
    (r) => normalizeSource(r.inference_source) !== 'mock',
  );
  const hasRealInference = realInference.length > 0;

  return {
    user_id: input.userId,
    session_id: input.sessionId,
    session_started_at: new Date(input.startedAt).toISOString(),
    session_ended_at: new Date(input.endedAt).toISOString(),
    session_duration_seconds: input.totalMs / 1000,
    speech_duration_seconds: input.speechMs / 1000,

    total_segments: rows.length,
    matched_segments: input.segmentsMatched,

    emotion_counts: emotionCounts,
    dominant_emotion: dominant(emotionCounts),
    need_counts: needCounts,
    dominant_need: dominant(needCounts),

    avg_rms_energy: avgRms,
    avg_pitch_mean_hz: avgPitch,
    avg_pitch_variability: avgPitchVar,
    avg_speaking_rate_wpm: avgWpm,
    avg_silence_ratio: avgSilence,
    avg_vocal_stress_index: avgStress,

    // Both NULL unless a real inference actually ran. This is the
    // belt-and-braces half of the quarantine — even a consumer that
    // forgets to check inference_source cannot read a fake number.
    avg_arousal: hasRealInference
      ? meanOf(realInference, (r) => r.acoustic_arousal)
      : null,
    avg_valence: hasRealInference
      ? meanOf(realInference, (r) => r.acoustic_valence)
      : null,
    inference_source: summariseSource(rows),
  };
}

/**
 * The summary's inference_source is the weakest provenance among the
 * segments that contributed a real inference. If nothing real
 * contributed, the summary is 'mock'.
 *
 * Weakest-wins is deliberate: a summary blending fused and plain
 * acoustic readings should not advertise itself as fully fused.
 */
function summariseSource(rows: SignalRow[]): InferenceSourceValue {
  const real = rows
    .map((r) => normalizeSource(r.inference_source))
    .filter((s): s is InferenceSourceValue => s !== 'mock');

  if (real.length === 0) return 'mock';

  let weakest: InferenceSourceValue = 'fused_v1';
  for (const source of real) {
    if (
      INFERENCE_SOURCE_PRIORITY.indexOf(source) <
      INFERENCE_SOURCE_PRIORITY.indexOf(weakest)
    ) {
      weakest = source;
    }
  }
  return weakest;
}

/**
 * Anything unrecognised is treated as mock. An unknown provenance is
 * not a trustworthy one.
 */
function normalizeSource(value: string | null): InferenceSourceValue {
  if (
    value === 'acoustic_v1' ||
    value === 'fused_v1'
  ) {
    return value;
  }
  return 'mock';
}

function countTokens(values: (string | null | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const token = value.trim();
    if (!token) continue;
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}

function dominant(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [token, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}

function meanOf(
  rows: SignalRow[],
  pick: (row: SignalRow) => number | null,
  opts: { positiveOnly?: boolean } = {},
): number | null {
  const values: number[] = [];
  for (const row of rows) {
    const picked = pick(row);
    // Reject null/undefined BEFORE coercing: Number(null) is 0, which
    // would quietly average a missing measurement in as a real zero
    // and drag the average down.
    if (picked === null || picked === undefined) continue;
    const raw = Number(picked);
    if (!Number.isFinite(raw)) continue;
    if (opts.positiveOnly && raw <= 0) continue;
    values.push(raw);
  }
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
