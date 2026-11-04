/**
 * Per-session aggregate of a listening session (Phase 3).
 *
 * One listening session produces many voice_signals rows. This folds them
 * into the single listening_summaries row that DOST actually reads —
 * the chat function's private tonal lens and the nightly synthesis.
 *
 * WHAT TRAVELS: labels and numbers only. Emotion/need counts (from the
 * transcript, already redacted) and averaged acoustic measurements.
 * Never audio, never transcript text.
 *
 * THE MOCK QUARANTINE. A summary mixes two kinds of data:
 *
 *   REAL  emotion/need distributions (semantic) and measured acoustic
 *         features — speaking rate, vocal strain, silence, pitch.
 *   MOCK  avg_arousal / avg_valence — acoustic emotion inference,
 *         faked since Phase 1 (see acousticInference.ts).
 *
 * inference_source describes the provenance of arousal/valence only, and
 * is deliberately pessimistic: one mock segment makes the whole summary's
 * arousal untrusted. Readers must show arousal/valence only for
 * 'acoustic_v1' / 'fused_v1'. Until Phase 4 validates a real model that
 * means never — so no fabricated number can reach a user or a prompt.
 */

export type InferenceSource = 'mock' | 'acoustic_v1' | 'fused_v1';

/** The subset of a voice_signals row this aggregate needs. */
export type VoiceSignalRow = {
  rms_energy: number | null;
  pitch_mean_hz: number | null;
  pitch_variability: number | null;
  speaking_rate_wpm: number | null;
  silence_ratio: number | null;
  vocal_stress_index: number | null;
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
  acoustic_arousal: number | null;
  acoustic_valence: number | null;
  inference_source: string | null;
};

/** Session facts the signals themselves don't carry. */
export type SessionTotals = {
  startedAt: number;
  endedAt: number;
  totalSeconds: number;
  speechSeconds: number;
  /** Every segment the speaker gate saw, matched or discarded. */
  totalSegments: number;
  /** Segments that passed the gate as the enrolled speaker. */
  matchedSegments: number;
};

/** Exactly the listening_summaries columns this device fills. */
export type ListeningSummaryDraft = {
  session_started_at: string;
  session_ended_at: string;
  session_duration_seconds: number;
  speech_duration_seconds: number;
  total_segments: number;
  matched_segments: number;
  emotion_counts: Record<string, number>;
  dominant_emotion: string | null;
  need_counts: Record<string, number>;
  dominant_need: string | null;
  avg_rms_energy: number | null;
  avg_pitch_mean_hz: number | null;
  avg_pitch_variability: number | null;
  avg_speaking_rate_wpm: number | null;
  avg_silence_ratio: number | null;
  avg_vocal_stress_index: number | null;
  avg_arousal: number | null;
  avg_valence: number | null;
  inference_source: InferenceSource;
};

const REAL_SOURCES = new Set<InferenceSource>(['acoustic_v1', 'fused_v1']);

function isRealSource(value: string | null): boolean {
  return value !== null && REAL_SOURCES.has(value as InferenceSource);
}

/**
 * Mean of the usable values, or null when there are none. `positiveOnly`
 * drops zeros for measurements where zero means "not detected" (pitch)
 * rather than a real reading of nothing.
 */
function mean(values: Array<number | null>, positiveOnly = false): number | null {
  const usable = values.filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && (!positiveOnly || n > 0),
  );
  if (usable.length === 0) return null;
  const sum = usable.reduce((a, b) => a + b, 0);
  return round3(sum / usable.length);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function addCount(counts: Record<string, number>, label: unknown): void {
  if (typeof label !== 'string') return;
  const key = label.trim();
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Highest count wins; ties break alphabetically so the result is stable. */
function dominant(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return entries[0][0];
}

/**
 * Provenance of the arousal/valence average. Pessimistic by design: a
 * single mock segment taints the average, so the whole summary is marked
 * mock and readers skip it.
 */
export function summaryInferenceSource(rows: VoiceSignalRow[]): InferenceSource {
  if (rows.length === 0) return 'mock';
  if (!rows.every((r) => isRealSource(r.inference_source))) return 'mock';
  const distinct = new Set(rows.map((r) => r.inference_source));
  if (distinct.size === 1) return [...distinct][0] as InferenceSource;
  return 'fused_v1';
}

export function summariseSignals(
  rows: VoiceSignalRow[],
  totals: SessionTotals,
): ListeningSummaryDraft {
  const emotion_counts: Record<string, number> = {};
  const need_counts: Record<string, number> = {};

  for (const row of rows) {
    addCount(emotion_counts, row.primary_emotion);
    for (const secondary of row.secondary_emotions ?? []) {
      addCount(emotion_counts, secondary);
    }
    addCount(need_counts, row.underlying_need);
  }

  return {
    session_started_at: new Date(totals.startedAt).toISOString(),
    session_ended_at: new Date(totals.endedAt).toISOString(),
    session_duration_seconds: round3(Math.max(0, totals.totalSeconds)),
    speech_duration_seconds: round3(Math.max(0, totals.speechSeconds)),
    total_segments: Math.max(0, Math.round(totals.totalSegments)),
    matched_segments: Math.max(0, Math.round(totals.matchedSegments)),
    emotion_counts,
    dominant_emotion: dominant(emotion_counts),
    need_counts,
    dominant_need: dominant(need_counts),
    avg_rms_energy: mean(rows.map((r) => r.rms_energy)),
    avg_pitch_mean_hz: mean(rows.map((r) => r.pitch_mean_hz), true),
    avg_pitch_variability: mean(rows.map((r) => r.pitch_variability)),
    avg_speaking_rate_wpm: mean(rows.map((r) => r.speaking_rate_wpm), true),
    avg_silence_ratio: mean(rows.map((r) => r.silence_ratio)),
    avg_vocal_stress_index: mean(rows.map((r) => r.vocal_stress_index)),
    avg_arousal: mean(rows.map((r) => r.acoustic_arousal)),
    avg_valence: mean(rows.map((r) => r.acoustic_valence)),
    inference_source: summaryInferenceSource(rows),
  };
}
