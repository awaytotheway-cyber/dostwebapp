/**
 * The rules behind a day's summary on Your Patterns. Pure — no imports,
 * no I/O — so every rule here is tested in daySummary_test.ts and the
 * function in index.ts only wires them to the database and the model.
 *
 * A summary is written from the person's own typed messages on one local
 * calendar day, plus that day's confident emotion labels. Never DOST's
 * replies and never listening data.
 */

/** Generations per person per rolling 24 hours. Saved days don't count. */
export const SUMMARY_CAP_PER_DAY = 40;
/** The strip shows 30 days; one extra day of slack for time-zone edges. */
export const MAX_DAYS_BACK = 31;
/** Same rule as listening (lib/hearing/sessionSummary.ts). */
export const MIN_LABEL_CONFIDENCE = 0.5;
const HIDDEN_LABELS = new Set(["neutral"]);
/** Below this many words, a summary would be invention. */
const MIN_WORDS = 12;
/** Characters of message text sent to the model; newest are kept. */
const MESSAGE_BUDGET_CHARS = 6000;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi (Devanagari script)",
  mr: "Marathi (Devanagari script)",
  es: "Spanish",
  de: "German",
  ru: "Russian",
  zh: "Simplified Chinese",
  ja: "Japanese",
};

export const TONES = ["light", "mixed", "heavy"] as const;
export type Tone = (typeof TONES)[number];

export const SYSTEM_PROMPT =
  `You are DOST, a warm, grounded companion. You are writing a short reflection on one day of a person's life, for that person to read later, from the messages they wrote to you that day.

Write in the second person ("you"), gently, like a friend who listened. 2 to 4 sentences.

Rules:
- Reflect what they wrote. Never add events, feelings or details they did not express.
- Never diagnose. No clinical or diagnostic words (disorder, diagnosis, symptoms, clinical, psychiatric, pathological). Use plain feeling words.
- No advice, no lists, no questions, no exclamation marks.
- Never quote names, places, phone numbers or other identifying details; speak of "your sister", "work", "a friend".
- If the day moved, say how ("by evening you sounded steadier").
- Judge the overall tone of the day from their words: "light" (mostly at ease or hopeful), "mixed" (ups and downs), or "heavy" (mostly hard or painful).
- Safety: if anything suggests self-harm, suicide, or harming someone else, set "safety" to true. Then keep the summary especially gentle and brief, and do not restate those details.

Return JSON only, exactly: {"tone": "light" | "mixed" | "heavy", "summary": string, "safety": boolean}`;

// ─── which day, in whose time zone ────────────────────────────────

export type Zone = { timeZone: string } | { utcOffsetMinutes: number };

export type DayRequest = {
  day: string;
  zone: Zone;
  language: string;
  isToday: boolean;
};

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = DAY_RE.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock minus UTC, in ms, at `instant` in `timeZone`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant of local midnight on y-m-d. Two passes for DST. */
function localMidnight(y: number, m: number, d: number, zone: Zone): number {
  const wall = Date.UTC(y, m - 1, d);
  if ("utcOffsetMinutes" in zone) return wall + zone.utcOffsetMinutes * 60_000;
  const first = wall - zoneOffsetMs(wall, zone.timeZone);
  const second = wall - zoneOffsetMs(first, zone.timeZone);
  return second;
}

export function dayBounds(day: string, zone: Zone): { startIso: string; endIso: string } {
  const parsed = parseDay(day);
  if (!parsed) throw new Error("invalid day");
  const { y, m, d } = parsed;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    startIso: new Date(localMidnight(y, m, d, zone)).toISOString(),
    endIso: new Date(
      localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone),
    ).toISOString(),
  };
}

/** The local calendar day ('YYYY-MM-DD') that `instant` falls on. */
export function localDayKey(instant: Date, zone: Zone): string {
  const shifted = "utcOffsetMinutes" in zone
    ? new Date(instant.getTime() - zone.utcOffsetMinutes * 60_000)
    : new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), zone.timeZone));
  return shifted.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function parseDayRequest(body: unknown, now = new Date()): DayRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;

  const day = typeof o.day === "string" ? o.day : "";
  if (!parseDay(day)) return null;

  let zone: Zone | null = null;
  if (typeof o.timeZone === "string" && isValidTimeZone(o.timeZone)) {
    zone = { timeZone: o.timeZone };
  } else if (
    typeof o.utcOffsetMinutes === "number" &&
    Number.isInteger(o.utcOffsetMinutes) &&
    Math.abs(o.utcOffsetMinutes) <= 14 * 60
  ) {
    zone = { utcOffsetMinutes: o.utcOffsetMinutes };
  }
  if (!zone) return null;

  const today = localDayKey(now, zone);
  const back = daysBetween(day, today);
  if (back < 0 || back > MAX_DAYS_BACK) return null;

  const language = typeof o.language === "string" && o.language in LANGUAGE_NAMES ? o.language : "en";
  return { day, zone, language, isToday: back === 0 };
}

// ─── the day's messages ───────────────────────────────────────────

export type SourceMessage = { id: string; content: string; created_at: string };

/** FNV-1a, 32-bit: small and stable, enough to notice a changed set. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Identifies the set of messages a summary was written from. Adding or
 * deleting a message changes it, so a saved summary is rewritten.
 */
export function fingerprint(messages: SourceMessage[]): string {
  const sorted = [...messages].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
  const basis = sorted.map((msg) => `${msg.id}|${msg.content.length}`).join(",");
  return `v1:${sorted.length}:${fnv1a(basis)}`;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/g;

/** Words, counting each CJK character as one (those scripts don't space words). */
function wordCount(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  const spaced = text.replace(CJK, " ").trim().split(/\s+/).filter(Boolean).length;
  return cjk + spaced;
}

export function isSparse(messages: SourceMessage[]): boolean {
  return messages.reduce((n, msg) => n + wordCount(msg.content), 0) < MIN_WORDS;
}

// ─── feeling chips ────────────────────────────────────────────────

export type EmotionLabelRow = {
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  confidence_score: number | null;
  is_ambiguous: boolean | null;
};

export function pickFeelings(rows: EmotionLabelRow[], limit = 3): string[] {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.is_ambiguous === true) continue;
    if (row.confidence_score === null || row.confidence_score === undefined) continue;
    const confidence = Number(row.confidence_score);
    if (!Number.isFinite(confidence) || confidence < MIN_LABEL_CONFIDENCE) continue;
    for (const raw of [row.primary_emotion, ...(row.secondary_emotions ?? [])]) {
      if (typeof raw !== "string") continue;
      const token = raw.trim().toLowerCase();
      if (!token || HIDDEN_LABELS.has(token)) continue;
      counts[token] = (counts[token] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

// ─── the model's input and output ─────────────────────────────────

export function buildUserPrompt(input: {
  messages: SourceMessage[];
  feelings: string[];
  languageName: string;
  isToday: boolean;
}): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const line = `- ${input.messages[i].content.replace(/\s+/g, " ").trim()}`;
    if (used + line.length > MESSAGE_BUDGET_CHARS && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  lines.reverse();
  return [
    input.isToday ? "Write about today so far; the day is not over." : "Write about this day.",
    `Write the summary in ${input.languageName}.`,
    `Feeling labels noticed in these messages: ${input.feelings.join(", ") || "none"}.`,
    "The person's own messages, oldest first:",
    ...lines,
  ].join("\n");
}

const DIAGNOSTIC = /\b(diagnos\w*|disorders?|clinical(ly)?|patholog\w*|psychiatr\w*|symptoms?)\b/i;
const SENTENCE_SPLIT = /[.!?।。！？]+/;

export type DaySummary = { tone: Tone; summary: string; safety: boolean };

/** The model's parsed JSON → a summary fit to show, or null. Never throws. */
export function validateSummary(raw: unknown): DaySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const tone = typeof o.tone === "string" ? o.tone.trim().toLowerCase() : "";
  if (!(TONES as readonly string[]).includes(tone)) return null;

  if (typeof o.summary !== "string") return null;
  const summary = o.summary
    .replace(/^[\s"“”'*_`#]+|[\s"“”'*_`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (summary.length < 40 || summary.length > 700) return null;
  const sentences = summary.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
  if (sentences.length < 1 || sentences.length > 5) return null;
  if (DIAGNOSTIC.test(summary)) return null;

  return { tone: tone as Tone, summary, safety: o.safety === true };
}

// ─── daily cap ────────────────────────────────────────────────────

export type RateState = { windowStart: string; count: number };

export function nextRateWindow(
  state: RateState | null,
  now: Date,
  cap = SUMMARY_CAP_PER_DAY,
): { allowed: boolean; next: RateState } {
  const started = state ? Date.parse(state.windowStart) : NaN;
  if (!state || !Number.isFinite(started) || now.getTime() - started >= RATE_WINDOW_MS) {
    return { allowed: true, next: { windowStart: now.toISOString(), count: 1 } };
  }
  if (state.count >= cap) return { allowed: false, next: state };
  return { allowed: true, next: { windowStart: state.windowStart, count: state.count + 1 } };
}
