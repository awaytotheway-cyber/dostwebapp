import NetInfo from '@react-native-community/netinfo';
import { getAppLanguage } from '../i18n';
import { supabase } from '../supabase';
import { buildDayCells, lastNDays, type DayCell, type Tone, TONES } from './dayStrip';

/**
 * Network side of the Your Patterns day view: the strip's data, and one
 * day's summary from the generate-day-summary function. The rules for
 * what the strip shows live in dayStrip.ts.
 */

export type DayResult =
  | {
      status: 'ok';
      day: string;
      tone: Tone;
      feelings: string[];
      summary: string;
      safety: boolean;
      isToday: boolean;
    }
  | { status: 'empty'; day: string }
  | { status: 'sparse'; day: string; feelings: string[] }
  | { status: 'capped'; day: string }
  | { status: 'offline'; day: string }
  | { status: 'error'; day: string };

/**
 * Past days are cached for the session: the server already returns a saved
 * summary instantly, this just avoids a round trip on every swipe. Today is
 * never cached, because it changes as you talk.
 */
const cache = new Map<string, DayResult>();

/** A request that hasn't answered by then is treated as failed, not waited on forever. */
const STRIP_TIMEOUT_MS = 12_000;
const SUMMARY_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function clearDaySummaryCache(): void {
  cache.clear();
}

function phoneTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** The phone's offset at noon on that day, as getTimezoneOffset() gives it. */
function offsetOn(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTimezoneOffset();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseResult(day: string, data: unknown): DayResult {
  if (!data || typeof data !== 'object') return { status: 'error', day };
  const o = data as Record<string, unknown>;
  switch (o.status) {
    case 'ok':
      if (
        typeof o.summary === 'string' &&
        typeof o.tone === 'string' &&
        (TONES as readonly string[]).includes(o.tone)
      ) {
        return {
          status: 'ok',
          day,
          tone: o.tone as Tone,
          feelings: stringList(o.feelings),
          summary: o.summary,
          safety: o.safety === true,
          isToday: o.is_today === true,
        };
      }
      return { status: 'error', day };
    case 'empty':
      return { status: 'empty', day };
    case 'sparse':
      return { status: 'sparse', day, feelings: stringList(o.feelings) };
    case 'capped':
      return { status: 'capped', day };
    default:
      return { status: 'error', day };
  }
}

export async function fetchDaySummary(day: string, isToday: boolean): Promise<DayResult> {
  const language = getAppLanguage();
  const key = `${day}|${language}`;
  const hit = cache.get(key);
  if (hit && !isToday) return hit;

  try {
    const net = await NetInfo.fetch();
    if (net.isConnected === false) return hit ?? { status: 'offline', day };
  } catch {
    // Unknown connectivity: try anyway.
  }

  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('generate-day-summary', {
        body: { day, timeZone: phoneTimeZone(), utcOffsetMinutes: offsetOn(day), language },
      }),
      SUMMARY_TIMEOUT_MS,
    );
    if (error) return hit ?? { status: 'error', day };
    const result = parseResult(day, data);
    if (result.status === 'ok' || result.status === 'empty' || result.status === 'sparse') {
      cache.set(key, result);
    }
    return result;
  } catch {
    return hit ?? { status: 'error', day };
  }
}

/**
 * The 30-day strip: which days you chatted on, and their saved tones.
 *
 * Throws when your messages can't be read (no connection, timeout): an
 * unreadable day must never be shown as a day you didn't talk.
 */
export async function loadDayCells(today = new Date()): Promise<DayCell[]> {
  const days = lastNDays(today);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days.length - 1));

  const [chats, summaries] = await withTimeout(Promise.all([
    supabase
      .from('conversations')
      .select('created_at')
      .eq('role', 'user')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .limit(5000),
    supabase
      .from('daily_summaries')
      .select('day, tone')
      .eq('language', getAppLanguage())
      .gte('day', days[0]),
  ]), STRIP_TIMEOUT_MS);
  if (chats.error) throw new Error('messages_unreadable');

  const chatTimestamps = (chats.data ?? [])
    .map((r) => (r as { created_at?: unknown }).created_at)
    .filter((v): v is string => typeof v === 'string');
  // A missing table (before the migration) or any read error just means
  // no tones yet; the strip still works from the messages alone.
  const tones = summaries.error
    ? []
    : (summaries.data ?? []).filter(
        (r): r is { day: string; tone: string } =>
          typeof (r as { day?: unknown }).day === 'string' &&
          typeof (r as { tone?: unknown }).tone === 'string',
      );

  return buildDayCells({ today, chatTimestamps, summaries: tones });
}
