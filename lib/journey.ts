import { FunctionsFetchError } from '@supabase/supabase-js';
import {
  labelForExtractedEmotion,
  labelForExtractedNeed,
} from './emotionalStates';
import { getAppLanguage, getLocaleTag, t, type TKey } from './i18n';
import { supabase } from './supabase';

export type JourneyRangeKey = '7d' | '30d' | 'all';

// `label` is the English label sent to the insight function; `labelKey` is shown.
export const JOURNEY_RANGES: { key: JourneyRangeKey; label: string; labelKey: TKey }[] = [
  { key: '7d', label: 'Past 7 days', labelKey: 'journey.range7d' },
  { key: '30d', label: 'Past 30 days', labelKey: 'journey.range30d' },
  { key: 'all', label: 'All time', labelKey: 'journey.rangeAll' },
];

export type EmotionPoint = {
  dayKey: string;
  label: string;
  dominant: string | null;
  count: number;
};

export type JourneyAggregate = {
  emotionCounts: Record<string, number>;
  needCounts: Record<string, number>;
  topEmotions: { token: string; count: number; label: string }[];
  topNeeds: { token: string; count: number; label: string }[];
  themeSentences: string[];
  weather: EmotionPoint[];
  totalTags: number;
  sparse: boolean;
};

type EmotionRow = {
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
  needs?: string[] | null;
  created_at: string;
};

const SPARSE_THRESHOLD = 3;

export function rangeStartIso(key: JourneyRangeKey, now = new Date()): string | null {
  if (key === 'all') return null;
  const days = key === '7d' ? 7 : 30;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString();
}

function bump(map: Record<string, number>, token: string | null | undefined, weight = 1) {
  if (!token || typeof token !== 'string') return;
  const key = token.trim().toLowerCase();
  if (!key) return;
  map[key] = (map[key] ?? 0) + weight;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function themeSentenceFor(token: string, count: number, total: number): string {
  const label = labelForExtractedEmotion(token);
  const lower = label.toLocaleLowerCase(getLocaleTag());
  const params = { label, labelLower: lower, labelCap: capitalize(lower) };
  const share = total > 0 ? count / total : 0;
  if (share >= 0.35) return t('journey.themeRecurring', params);
  if (share >= 0.2) return t('journey.themeOften', params);
  if (count >= 3) return t('journey.themeTraces', params);
  return t('journey.themeSoft', params);
}

function buildWeather(
  rows: EmotionRow[],
  rangeKey: JourneyRangeKey,
  now = new Date(),
): EmotionPoint[] {
  const byDay = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const key = dayKey(row.created_at);
    if (!key) continue;
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = {};
      byDay.set(key, bucket);
    }
    bump(bucket, row.primary_emotion, 1);
    if (Array.isArray(row.secondary_emotions)) {
      for (const s of row.secondary_emotions) bump(bucket, s, 0.5);
    }
  }

  const days: string[] = [];
  if (rangeKey === 'all') {
    const keys = [...byDay.keys()].sort();
    days.push(...keys.slice(-30));
  } else {
    const span = rangeKey === '7d' ? 7 : 30;
    for (let i = span - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push(dayKey(d.toISOString()));
    }
  }

  return days.map((key) => {
    const bucket = byDay.get(key) ?? {};
    let dominant: string | null = null;
    let best = 0;
    let count = 0;
    for (const [token, n] of Object.entries(bucket)) {
      count += n;
      if (n > best) {
        best = n;
        dominant = token;
      }
    }
    return {
      dayKey: key,
      label: dayLabel(key),
      dominant,
      count: Math.round(count),
    };
  });
}

export function aggregateJourneyRows(
  rows: EmotionRow[],
  rangeKey: JourneyRangeKey,
): JourneyAggregate {
  const emotionCounts: Record<string, number> = {};
  const needCounts: Record<string, number> = {};

  for (const row of rows) {
    bump(emotionCounts, row.primary_emotion, 1);
    if (Array.isArray(row.secondary_emotions)) {
      for (const s of row.secondary_emotions) bump(emotionCounts, s, 0.5);
    }
    bump(needCounts, row.underlying_need, 1);
    if (Array.isArray(row.needs)) {
      for (const n of row.needs) bump(needCounts, n, 1);
    }
  }

  // Round half-weights for cleaner display / API.
  for (const key of Object.keys(emotionCounts)) {
    emotionCounts[key] = Math.max(1, Math.round(emotionCounts[key]));
  }

  const totalTags = Object.values(emotionCounts).reduce((a, b) => a + b, 0);

  const topEmotions = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token, count]) => ({
      token,
      count,
      label: labelForExtractedEmotion(token),
    }));

  const topNeeds = Object.entries(needCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token, count]) => ({
      token,
      count,
      label: labelForExtractedNeed(token),
    }));

  const themeSentences = topEmotions
    .slice(0, 5)
    .map((e) => themeSentenceFor(e.token, e.count, totalTags));

  return {
    emotionCounts,
    needCounts,
    topEmotions,
    topNeeds,
    themeSentences,
    weather: buildWeather(rows, rangeKey),
    totalTags,
    sparse: totalTags < SPARSE_THRESHOLD,
  };
}

export async function loadJourneyAggregate(
  rangeKey: JourneyRangeKey,
): Promise<
  | { ok: true; aggregate: JourneyAggregate }
  | { ok: false; message: string }
> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return { ok: false, message: t('journey.openFailed') };
    }

    const since = rangeStartIso(rangeKey);

    let emotionsQuery = supabase
      .from('message_emotions')
      .select(
        'primary_emotion, secondary_emotions, underlying_need, needs, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(800);

    let voiceQuery = supabase
      .from('voice_notes')
      .select(
        'primary_emotion, secondary_emotions, underlying_need, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(400);

    if (since) {
      emotionsQuery = emotionsQuery.gte('created_at', since);
      voiceQuery = voiceQuery.gte('created_at', since);
    }

    let [emotionsRes, voiceRes] = await Promise.all([emotionsQuery, voiceQuery]);

    // Older DBs may lack enrichment columns — retry a leaner select.
    if (emotionsRes.error) {
      let lean = supabase
        .from('message_emotions')
        .select(
          'primary_emotion, secondary_emotions, underlying_need, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(800);
      if (since) lean = lean.gte('created_at', since);
      // Lean select omits `needs`; cast keeps the shared response shape for callers below.
      emotionsRes = (await lean) as typeof emotionsRes;
    }

    if (emotionsRes.error && voiceRes.error) {
      return {
        ok: false,
        message: t('journey.loadFailed'),
      };
    }

    const rows: EmotionRow[] = [];

    if (!emotionsRes.error && Array.isArray(emotionsRes.data)) {
      for (const row of emotionsRes.data) {
        if (!row || typeof row !== 'object') continue;
        const created_at =
          typeof row.created_at === 'string' ? row.created_at : '';
        if (!created_at) continue;
        const needsField = 'needs' in row ? (row as { needs?: unknown }).needs : null;
        rows.push({
          primary_emotion:
            typeof row.primary_emotion === 'string' ? row.primary_emotion : null,
          secondary_emotions: Array.isArray(row.secondary_emotions)
            ? row.secondary_emotions.filter((t): t is string => typeof t === 'string')
            : null,
          underlying_need:
            typeof row.underlying_need === 'string' ? row.underlying_need : null,
          needs: Array.isArray(needsField)
            ? needsField.filter((t): t is string => typeof t === 'string')
            : null,
          created_at,
        });
      }
    }

    if (!voiceRes.error && Array.isArray(voiceRes.data)) {
      for (const row of voiceRes.data) {
        if (!row || typeof row !== 'object') continue;
        const created_at =
          typeof row.created_at === 'string' ? row.created_at : '';
        if (!created_at) continue;
        // Skip voice notes with no emotion labels yet.
        const primary =
          typeof row.primary_emotion === 'string' ? row.primary_emotion : null;
        const secondary = Array.isArray(row.secondary_emotions)
          ? row.secondary_emotions.filter((t): t is string => typeof t === 'string')
          : null;
        if (!primary && (!secondary || secondary.length === 0)) continue;
        rows.push({
          primary_emotion: primary,
          secondary_emotions: secondary,
          underlying_need:
            typeof row.underlying_need === 'string' ? row.underlying_need : null,
          created_at,
        });
      }
    }

    return { ok: true, aggregate: aggregateJourneyRows(rows, rangeKey) };
  } catch {
    return {
      ok: false,
      message: t('journey.loadFailed'),
    };
  }
}

export type JourneyInsightResult =
  | { ok: true; insight: string | null; status: 'ok' | 'empty'; cached: boolean }
  | { ok: false; message: string };

export async function fetchJourneyInsight(input: {
  rangeKey: JourneyRangeKey;
  rangeLabel: string;
  emotionCounts: Record<string, number>;
  topNeeds: string[];
}): Promise<JourneyInsightResult> {
  try {
    const { data, error, response } = await supabase.functions.invoke<{
      status?: unknown;
      insight?: unknown;
      cached?: unknown;
      error?: unknown;
    }>('generate-journey-insight', {
      body: {
        range_key: input.rangeKey,
        range_label: input.rangeLabel,
        language: getAppLanguage(),
        emotion_counts: input.emotionCounts,
        top_needs: input.topNeeds,
      },
    });

    if (error) {
      const status =
        typeof response?.status === 'number'
          ? response.status
          : error &&
              typeof error === 'object' &&
              'context' in error &&
              error.context &&
              typeof (error.context as { status?: unknown }).status === 'number'
            ? (error.context as { status: number }).status
            : undefined;
      const isNetwork =
        error instanceof FunctionsFetchError ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: string }).name === 'FunctionsFetchError');
      if (status === 401) {
        return {
          ok: false,
          message: t('journey.sessionFailed'),
        };
      }
      return {
        ok: false,
        message: isNetwork
          ? t('journey.offline')
          : t('journey.gentleError'),
      };
    }

    if (data?.status === 'empty') {
      return { ok: true, insight: null, status: 'empty', cached: false };
    }

    const insight =
      typeof data?.insight === 'string' ? data.insight.trim() : '';
    if (!insight) {
      return { ok: true, insight: null, status: 'empty', cached: false };
    }

    return {
      ok: true,
      insight,
      status: 'ok',
      cached: data?.cached === true,
    };
  } catch {
    return { ok: false, message: t('journey.gentleError') };
  }
}

/** Soft earth tones for emotion weather (Dawn Earth). */
export function toneForEmotion(token: string | null | undefined): string {
  if (!token) return '#C9B79C';
  const t = token.toLowerCase();

  if (
    t === 'anger' ||
    t === 'anger_grief' ||
    t === 'frustration' ||
    t === 'resentment' ||
    t === 'contempt'
  ) {
    return '#C4A484';
  }
  if (
    t === 'anxiety' ||
    t === 'fear' ||
    t === 'overwhelm' ||
    t === 'helplessness'
  ) {
    return '#C9B5A8';
  }
  if (
    t === 'sadness' ||
    t === 'grief' ||
    t === 'loneliness' ||
    t === 'hurt' ||
    t === 'longing' ||
    t === 'emptiness' ||
    t === 'abandonment'
  ) {
    return '#A89F94';
  }
  if (
    t === 'shame' ||
    t === 'guilt' ||
    t === 'inadequacy' ||
    t === 'humiliation' ||
    t === 'embarrassment'
  ) {
    return '#B8A99A';
  }
  if (
    t === 'resignation' ||
    t === 'detachment' ||
    t === 'numbness' ||
    t === 'denial' ||
    t === 'weariness'
  ) {
    return '#A8A890';
  }
  if (t === 'envy' || t === 'jealousy' || t === 'pride') {
    return '#B5A890';
  }
  return '#B8A090';
}
