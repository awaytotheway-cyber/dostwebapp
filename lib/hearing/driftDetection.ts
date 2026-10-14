import { supabase } from '../supabase';

/**
 * Drift detection for listening sessions.
 *
 * Compares recent sessions (last 3) against a longer baseline (last 14
 * days) to detect meaningful shifts in emotional patterns or acoustic
 * features. Returns a drift report with specific dimensions that
 * shifted.
 *
 * Fail-open: errors return null (no drift detected).
 */

export type DriftDimension = {
  dimension: string;
  label: string;
  baselineValue: number;
  recentValue: number;
  direction: 'up' | 'down';
  magnitude: number;
};

export type DriftReport = {
  hasDrift: boolean;
  dimensions: DriftDimension[];
  dominantEmotionShift: { from: string; to: string } | null;
  dominantNeedShift: { from: string; to: string } | null;
  shouldPromptReEnrollment: boolean;
};

const DRIFT_THRESHOLDS = {
  vocal_stress: 0.15,
  speaking_rate: 25,
  silence_ratio: 0.1,
  arousal: 0.15,
  valence: 0.15,
} as const;

export async function detectDrift(userId: string): Promise<DriftReport | null> {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: allSummaries, error } = await supabase
      .from('listening_summaries')
      .select(
        'session_started_at, emotion_counts, dominant_emotion, need_counts, dominant_need, avg_vocal_stress_index, avg_speaking_rate_wpm, avg_silence_ratio, avg_arousal, avg_valence, matched_segments',
      )
      .eq('user_id', userId)
      .gte('session_started_at', fourteenDaysAgo.toISOString())
      .order('session_started_at', { ascending: false });

    if (error || !allSummaries || allSummaries.length < 4) return null;

    const recent = allSummaries.slice(0, 3);
    const baseline = allSummaries.slice(3);

    if (baseline.length < 1) return null;

    const dimensions: DriftDimension[] = [];

    checkNumericDrift(
      dimensions,
      'vocal_stress',
      'Vocal stress',
      baseline,
      recent,
      'avg_vocal_stress_index',
      DRIFT_THRESHOLDS.vocal_stress,
    );
    checkNumericDrift(
      dimensions,
      'speaking_rate',
      'Speaking rate',
      baseline,
      recent,
      'avg_speaking_rate_wpm',
      DRIFT_THRESHOLDS.speaking_rate,
    );
    checkNumericDrift(
      dimensions,
      'silence_ratio',
      'Silence ratio',
      baseline,
      recent,
      'avg_silence_ratio',
      DRIFT_THRESHOLDS.silence_ratio,
    );
    checkNumericDrift(
      dimensions,
      'arousal',
      'Arousal level',
      baseline,
      recent,
      'avg_arousal',
      DRIFT_THRESHOLDS.arousal,
    );
    checkNumericDrift(
      dimensions,
      'valence',
      'Emotional valence',
      baseline,
      recent,
      'avg_valence',
      DRIFT_THRESHOLDS.valence,
    );

    const baselineDominantEmotion = aggregateDominant(baseline, 'emotion_counts');
    const recentDominantEmotion = aggregateDominant(recent, 'emotion_counts');
    const emotionShift =
      baselineDominantEmotion &&
      recentDominantEmotion &&
      baselineDominantEmotion !== recentDominantEmotion
        ? { from: baselineDominantEmotion, to: recentDominantEmotion }
        : null;

    const baselineDominantNeed = aggregateDominant(baseline, 'need_counts');
    const recentDominantNeed = aggregateDominant(recent, 'need_counts');
    const needShift =
      baselineDominantNeed &&
      recentDominantNeed &&
      baselineDominantNeed !== recentDominantNeed
        ? { from: baselineDominantNeed, to: recentDominantNeed }
        : null;

    const hasDrift =
      dimensions.length > 0 || emotionShift !== null || needShift !== null;

    // Re-enrollment prompt: significant speaker gate discards suggest
    // the voiceprint may have drifted. Check the voice_sessions for
    // high discard rates in recent sessions.
    const shouldPromptReEnrollment = await checkReEnrollmentNeed(userId);

    return {
      hasDrift,
      dimensions,
      dominantEmotionShift: emotionShift,
      dominantNeedShift: needShift,
      shouldPromptReEnrollment,
    };
  } catch {
    return null;
  }
}

function checkNumericDrift(
  dimensions: DriftDimension[],
  dimension: string,
  label: string,
  baseline: Array<Record<string, unknown>>,
  recent: Array<Record<string, unknown>>,
  key: string,
  threshold: number,
): void {
  const baselineVal = meanField(baseline, key);
  const recentVal = meanField(recent, key);
  if (baselineVal === null || recentVal === null) return;

  const diff = recentVal - baselineVal;
  if (Math.abs(diff) >= threshold) {
    dimensions.push({
      dimension,
      label,
      baselineValue: baselineVal,
      recentValue: recentVal,
      direction: diff > 0 ? 'up' : 'down',
      magnitude: Math.abs(diff),
    });
  }
}

function meanField(
  rows: Array<Record<string, unknown>>,
  key: string,
): number | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = Number(r[key]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function aggregateDominant(
  rows: Array<Record<string, unknown>>,
  countsKey: string,
): string | null {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const counts = (r[countsKey] ?? {}) as Record<string, number>;
    for (const [k, v] of Object.entries(counts)) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(totals)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

async function checkReEnrollmentNeed(userId: string): Promise<boolean> {
  try {
    const { data: recentSessions } = await supabase
      .from('voice_sessions')
      .select(
        'segments_processed, segments_matched, segments_discarded_other_speaker, segments_discarded_ambiguous',
      )
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(3);

    if (!recentSessions || recentSessions.length === 0) return false;

    let totalProcessed = 0;
    let totalDiscarded = 0;
    for (const s of recentSessions) {
      totalProcessed += Number(s.segments_processed) || 0;
      totalDiscarded +=
        (Number(s.segments_discarded_ambiguous) || 0) +
        (Number(s.segments_discarded_other_speaker) || 0);
    }

    if (totalProcessed + totalDiscarded < 10) return false;
    const discardRate = totalDiscarded / (totalProcessed + totalDiscarded);
    return discardRate > 0.4;
  } catch {
    return false;
  }
}
