/**
 * The day strip on Your Patterns: which local days it shows, which of
 * them you chatted on, and their tone once summarised. Pure — no React
 * Native, no network — so it is tested directly (dayStrip_test.ts).
 *
 * Days are the phone's local calendar days, the same days the server
 * groups messages by (generate-day-summary is sent the phone's zone).
 */

export const STRIP_DAYS = 30;

export const TONES = ['light', 'mixed', 'heavy'] as const;
export type Tone = (typeof TONES)[number];

export type DayCell = { day: string; hasChats: boolean; tone: Tone | null };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' for the local calendar day `date` falls on. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last `n` local days, oldest first, ending today. */
export function lastNDays(today: Date, n = STRIP_DAYS): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(localDayKey(d));
  }
  return out;
}

function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

export function buildDayCells(input: {
  today: Date;
  chatTimestamps: string[];
  summaries: Array<{ day: string; tone: string }>;
  n?: number;
}): DayCell[] {
  const days = lastNDays(input.today, input.n ?? STRIP_DAYS);
  const inRange = new Set(days);

  const chatted = new Set<string>();
  for (const ts of input.chatTimestamps) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDayKey(date);
    if (inRange.has(key)) chatted.add(key);
  }

  const tones = new Map<string, Tone>();
  for (const s of input.summaries) {
    if (inRange.has(s.day) && isTone(s.tone)) tones.set(s.day, s.tone);
  }

  // A tone shows only on a day that still has messages: a summary left
  // over after every message that day was deleted must not.
  return days.map((day) => ({
    day,
    hasChats: chatted.has(day),
    tone: chatted.has(day) ? tones.get(day) ?? null : null,
  }));
}

/** The most recent day you chatted, or today when there is none. */
export function defaultSelectedDay(cells: DayCell[]): string {
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].hasChats) return cells[i].day;
  }
  return cells[cells.length - 1]?.day ?? '';
}

/** The day one step older or newer, or null at either end. */
export function neighbourDay(cells: DayCell[], day: string, direction: 'older' | 'newer'): string | null {
  const i = cells.findIndex((c) => c.day === day);
  if (i < 0) return null;
  const j = direction === 'older' ? i - 1 : i + 1;
  return cells[j]?.day ?? null;
}
