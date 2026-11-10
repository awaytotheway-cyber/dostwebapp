/**
 * The listening side of Your Journey.
 *
 * Listening sessions have been writing listening_summaries rows since
 * Phase 3, and until now nothing ever showed them to the person they
 * came from. Data collected and never shown back is surveillance; shown
 * back, it is a mirror. This module is that mirror.
 *
 * WHAT IS DELIBERATELY LEFT OUT, and why:
 *
 *   avg_arousal / avg_valence — mocked since Phase 1. The quarantine
 *   rule is that they may be read only from rows tagged 'acoustic_v1'
 *   or 'fused_v1', which until Phase 4 validates a real model means
 *   never. hasRealAcoustic is the single place that changes when it
 *   does, so no fabricated number can reach the screen by accident.
 *
 *   avg_vocal_stress_index — a real measurement, but documented in
 *   acousticFeatures.ts as an unvalidated heuristic composite. "Your
 *   stress was 0.72" in an app about feelings is false authority: a
 *   number carries more conviction than the thing behind it earns.
 *
 *   avg_speaking_rate_wpm, avg_pitch_mean_hz and the rest — honest
 *   measurements that mean nothing useful to a person reading them, and
 *   invite self-measurement where the app is trying to offer presence.
 *
 *   neutral — the classifier's label for speech that carries no feeling
 *   (and, since the hearing pipeline counts only confident labels, never
 *   written into new summaries). Older builds counted it, so it is
 *   dropped here too: ordinary talk is not an emotion.
 *
 * What is left is what the words themselves carried: the feelings and
 * needs heard, and an honest account of how much was listened to.
 *
 * These counts are kept SEPARATE from the typed-message counts rather
 * than added to them. Speech overheard in the room was never addressed
 * to DOST. Folding it into one total would quietly inflate what the
 * person sees with data they did not choose to offer, and leave them no
 * way to tell the two apart.
 */

/**
 * This module deliberately imports nothing. Label lookup is injected by
 * the caller rather than imported, so the aggregation stays pure, has no
 * React Native dependency, and can be tested directly.
 */

/** The subset of listening_summaries columns this screen reads. */
export type ListeningSummaryRow = {
  session_started_at: string | null;
  session_duration_seconds: number | null;
  speech_duration_seconds: number | null;
  emotion_counts: Record<string, unknown> | null;
  need_counts: Record<string, unknown> | null;
  inference_source: string | null;
};

export type ListeningTally = { token: string; count: number; label: string };

export type ListeningReflection = {
  sessions: number;
  listenedSeconds: number;
  speechSeconds: number;
  topEmotions: ListeningTally[];
  topNeeds: ListeningTally[];
  /**
   * True only when every contributing summary carried a real acoustic
   * source. Pessimistic by design, and false for all of Phase 1-3, so
   * the mocked arousal/valence can never be presented as a finding.
   */
  hasRealAcoustic: boolean;
  /** Too little heard to say anything honestly. */
  sparse: boolean;
};

const REAL_SOURCES = new Set(['acoustic_v1', 'fused_v1']);

/** Below this many labels, a pattern claim would be noise. */
const SPARSE_THRESHOLD = 3;

/** Kept in step with HIDDEN_EMOTIONS in lib/hearing/sessionSummary.ts. */
const HIDDEN_TOKENS = new Set(['neutral']);

function addCounts(
  into: Record<string, number>,
  counts: Record<string, unknown> | null | undefined,
): void {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return;
  for (const [rawToken, rawCount] of Object.entries(counts)) {
    const token = typeof rawToken === 'string' ? rawToken.trim().toLowerCase() : '';
    if (!token || HIDDEN_TOKENS.has(token)) continue;
    const n = typeof rawCount === 'number' ? rawCount : Number(rawCount);
    // Counts arrive from jsonb, so anything could be in there. Negative
    // and non-finite values are dropped rather than clamped: a bad row
    // should not get a vote at all.
    if (!Number.isFinite(n) || n <= 0) continue;
    into[token] = (into[token] ?? 0) + n;
  }
}

function seconds(value: number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function rank(
  counts: Record<string, number>,
  label: (token: string) => string,
  limit = 4,
): ListeningTally[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token, count]) => ({
      token,
      count: Math.round(count),
      label: label(token),
    }));
}

/** How to turn a stored token into something a person reads. */
export type LabelResolvers = {
  emotion: (token: string) => string;
  need: (token: string) => string;
};

/** Readable enough to be a safe default, and used by the tests. */
const PLAIN: LabelResolvers = {
  emotion: (token) => token.replace(/_/g, ' '),
  need: (token) => token.replace(/_/g, ' '),
};

export function aggregateListeningSummaries(
  rows: ListeningSummaryRow[],
  labels: LabelResolvers = PLAIN,
): ListeningReflection | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const emotionCounts: Record<string, number> = {};
  const needCounts: Record<string, number> = {};
  let listenedSeconds = 0;
  let speechSeconds = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    addCounts(emotionCounts, row.emotion_counts);
    addCounts(needCounts, row.need_counts);
    listenedSeconds += seconds(row.session_duration_seconds);
    speechSeconds += seconds(row.speech_duration_seconds);
  }

  const topEmotions = rank(emotionCounts, labels.emotion);
  const topNeeds = rank(needCounts, labels.need);
  const totalLabels = Object.values(emotionCounts).reduce((a, b) => a + b, 0);

  return {
    sessions: rows.length,
    listenedSeconds: Math.round(listenedSeconds),
    speechSeconds: Math.round(speechSeconds),
    topEmotions,
    topNeeds,
    hasRealAcoustic: rows.every((r) => REAL_SOURCES.has(r?.inference_source ?? '')),
    sparse: totalLabels < SPARSE_THRESHOLD,
  };
}

/**
 * Rounded, forgiving duration for display — "about 2 hours", not
 * "7,214 seconds". Deliberately vague: the point is to tell someone
 * roughly how much was heard, not to hand them a stopwatch reading.
 */
export function describeListenedDuration(totalSeconds: number): {
  key: 'journey.listeningMinutes' | 'journey.listeningHours';
  amount: number;
} {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 90) return { key: 'journey.listeningMinutes', amount: minutes };
  return { key: 'journey.listeningHours', amount: Math.round(minutes / 60) };
}
