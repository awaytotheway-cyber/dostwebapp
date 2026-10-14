import { supabase } from '../supabase';

/**
 * Generate a listening summary for a completed session.
 *
 * Aggregates voice_signals rows into a single listening_summaries row
 * holding emotion/need token counts, acoustic averages, and session
 * metrics. Never stores transcript text or audio — only labels and
 * numbers from the fixed vocabulary.
 *
 * Fail-open: errors are swallowed so a summary failure never breaks
 * the session stop flow.
 */
export async function generateListeningSummary(
  sessionId: string,
  userId: string,
): Promise<void> {
  try {
    const { data: session } = await supabase
      .from('voice_sessions')
      .select(
        'started_at, ended_at, total_duration_seconds, speech_duration_seconds, segments_processed, segments_matched',
      )
      .eq('id', sessionId)
      .maybeSingle();

    if (!session?.started_at || !session?.ended_at) return;

    const { data: signals } = await supabase
      .from('voice_signals')
      .select(
        'primary_emotion, underlying_need, rms_energy, pitch_mean_hz, pitch_variability, speaking_rate_wpm, silence_ratio, vocal_stress_index, acoustic_arousal, acoustic_valence, inference_source',
      )
      .eq('session_id', sessionId);

    const rows = signals ?? [];
    if (rows.length === 0) return;

    const emotionCounts: Record<string, number> = {};
    const needCounts: Record<string, number> = {};

    for (const r of rows) {
      if (typeof r.primary_emotion === 'string' && r.primary_emotion) {
        emotionCounts[r.primary_emotion] =
          (emotionCounts[r.primary_emotion] ?? 0) + 1;
      }
      if (typeof r.underlying_need === 'string' && r.underlying_need) {
        needCounts[r.underlying_need] =
          (needCounts[r.underlying_need] ?? 0) + 1;
      }
    }

    const dominantEmotion = maxKey(emotionCounts);
    const dominantNeed = maxKey(needCounts);

    const nonMock = rows.filter((r) => r.inference_source !== 'mock');

    await supabase.from('listening_summaries').upsert(
      {
        user_id: userId,
        session_id: sessionId,
        session_started_at: session.started_at,
        session_ended_at: session.ended_at,
        session_duration_seconds: Number(session.total_duration_seconds) || 0,
        speech_duration_seconds: Number(session.speech_duration_seconds) || 0,
        total_segments: Number(session.segments_processed) || rows.length,
        matched_segments: Number(session.segments_matched) || 0,
        emotion_counts: emotionCounts,
        dominant_emotion: dominantEmotion,
        need_counts: needCounts,
        dominant_need: dominantNeed,
        avg_rms_energy: meanNum(rows, 'rms_energy'),
        avg_pitch_mean_hz: meanNum(rows, 'pitch_mean_hz'),
        avg_pitch_variability: meanNum(rows, 'pitch_variability'),
        avg_speaking_rate_wpm: meanNum(rows, 'speaking_rate_wpm'),
        avg_silence_ratio: meanNum(rows, 'silence_ratio'),
        avg_vocal_stress_index: meanNum(rows, 'vocal_stress_index'),
        avg_arousal: nonMock.length > 0 ? meanNum(nonMock, 'acoustic_arousal') : null,
        avg_valence: nonMock.length > 0 ? meanNum(nonMock, 'acoustic_valence') : null,
      },
      { onConflict: 'session_id' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[hearing] summary generation failed:', err);
  }
}

function maxKey(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function meanNum(
  rows: Array<Record<string, unknown>>,
  key: string,
): number | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = Number(r[key]);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
