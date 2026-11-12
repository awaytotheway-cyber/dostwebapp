// Deno test: deno test supabase/functions/generate-day-summary/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildUserPrompt,
  dayBounds,
  fingerprint,
  isSparse,
  nextRateWindow,
  parseDayRequest,
  pickFeelings,
  SUMMARY_CAP_PER_DAY,
  SYSTEM_PROMPT,
  validateSummary,
} from "./daySummary.ts";

// ─── which day, in whose time zone ────────────────────────────────

Deno.test("a local day in India starts at 18:30 UTC the day before", () => {
  assertEquals(dayBounds("2026-11-11", { timeZone: "Asia/Kolkata" }), {
    startIso: "2026-11-10T18:30:00.000Z",
    endIso: "2026-11-11T18:30:00.000Z",
  });
});

Deno.test("a day across a DST change is 23 hours long, not 24", () => {
  // Europe/Berlin springs forward on 2026-03-29.
  const { startIso, endIso } = dayBounds("2026-03-29", { timeZone: "Europe/Berlin" });
  assertEquals(startIso, "2026-03-28T23:00:00.000Z");
  assertEquals(endIso, "2026-03-29T22:00:00.000Z");
});

Deno.test("without a usable zone name, the phone's UTC offset is used", () => {
  // getTimezoneOffset() is -330 in India: minutes to add to local to reach UTC.
  assertEquals(dayBounds("2026-11-11", { utcOffsetMinutes: -330 }), {
    startIso: "2026-11-10T18:30:00.000Z",
    endIso: "2026-11-11T18:30:00.000Z",
  });
});

Deno.test("requests are validated, and the language falls back to English", () => {
  const now = new Date("2026-11-12T06:00:00Z");
  assertEquals(
    parseDayRequest({ day: "2026-11-11", timeZone: "Asia/Kolkata", language: "hi" }, now),
    { day: "2026-11-11", zone: { timeZone: "Asia/Kolkata" }, language: "hi", isToday: false },
  );
  assertEquals(
    parseDayRequest({ day: "2026-11-12", timeZone: "Asia/Kolkata", language: "xx" }, now)?.language,
    "en",
  );
  assertEquals(
    parseDayRequest({ day: "2026-11-12", timeZone: "Asia/Kolkata" }, now)?.isToday,
    true,
  );
  // An invalid zone name falls back to the offset when one is given…
  assertEquals(
    parseDayRequest({ day: "2026-11-11", timeZone: "Mars/Olympus", utcOffsetMinutes: -330 }, now)?.zone,
    { utcOffsetMinutes: -330 },
  );
  // …and is rejected when nothing usable is given.
  assertEquals(parseDayRequest({ day: "2026-11-11", timeZone: "Mars/Olympus" }, now), null);
});

Deno.test("only real, recent, non-future days are accepted", () => {
  const now = new Date("2026-11-12T06:00:00Z");
  const zone = { timeZone: "Asia/Kolkata" };
  for (const day of ["2026-11-13", "2026-02-30", "11-11-2026", "", "2026-1-1"]) {
    assertEquals(parseDayRequest({ day, ...zone }, now), null, day);
  }
  // Older than the 30-day strip (plus a day of slack) is refused.
  assertEquals(parseDayRequest({ day: "2026-10-10", ...zone }, now), null);
  assert(parseDayRequest({ day: "2026-10-14", ...zone }, now) !== null);
  assertEquals(parseDayRequest(null, now), null);
});

// ─── when a saved summary is still good ───────────────────────────

const m = (id: string, content: string, created_at: string) => ({ id, content, created_at });

Deno.test("the fingerprint changes when a message is added or deleted", () => {
  const day = [
    m("1", "Couldn't sleep again", "2026-11-11T03:00:00Z"),
    m("2", "Work is piling up", "2026-11-11T09:00:00Z"),
  ];
  const fp = fingerprint(day);
  assertEquals(fingerprint([...day]), fp, "same messages, same fingerprint");
  assert(fingerprint([...day, m("3", "Better now", "2026-11-11T15:00:00Z")]) !== fp, "added");
  assert(fingerprint([day[1]]) !== fp, "deleted");
  assert(fingerprint([day[0]]) !== fingerprint([day[1]]), "a different message");
});

Deno.test("a couple of short lines is too little to summarise honestly", () => {
  assertEquals(isSparse([m("1", "hi", "x"), m("2", "ok thanks", "x")]), true);
  assertEquals(
    isSparse([m("1", "I keep thinking about the argument with my sister and I feel awful about it", "x")]),
    false,
  );
});

// ─── feeling chips ────────────────────────────────────────────────

const label = (
  primary: string | null,
  confidence: number | null,
  extra: Partial<{ secondary_emotions: string[] | null; is_ambiguous: boolean | null }> = {},
) => ({ primary_emotion: primary, secondary_emotions: null, confidence_score: confidence, is_ambiguous: false, ...extra });

Deno.test("chips count only confident, unambiguous labels — the listening rule", () => {
  const feelings = pickFeelings([
    label("anxiety", 0.9),
    label("anxiety", 0.8, { secondary_emotions: ["overwhelm"] }),
    label("overwhelm", 0.7),
    label("shame", 0.3),
    label("grief", 0.9, { is_ambiguous: true }),
    label("neutral", 0.95),
    label(null, 0.9),
  ]);
  assertEquals(feelings, ["anxiety", "overwhelm"]);
});

Deno.test("at most three chips, ties broken alphabetically", () => {
  assertEquals(
    pickFeelings(["fear", "anger", "grief", "hurt"].map((e) => label(e, 0.9))),
    ["anger", "fear", "grief"],
  );
  assertEquals(pickFeelings([label("fear", "0.6" as unknown as number)]), ["fear"]);
});

// ─── checking what the model wrote ────────────────────────────────

const good = {
  tone: "heavy",
  summary: "A heavier day. Worry about the deadline kept returning, and you were hard on yourself about it. By evening you sounded a little steadier.",
  safety: false,
};

Deno.test("a well-formed answer passes", () => {
  assertEquals(validateSummary(good), good);
  assertEquals(validateSummary({ ...good, tone: "Light" })?.tone, "light");
});

Deno.test("a missing or invalid tone is rejected", () => {
  assertEquals(validateSummary({ ...good, tone: "anxious" }), null);
  assertEquals(validateSummary({ summary: good.summary }), null);
});

Deno.test("too short, too long or too many sentences is rejected", () => {
  assertEquals(validateSummary({ ...good, summary: "Fine." }), null);
  assertEquals(validateSummary({ ...good, summary: "A long day. ".repeat(80) }), null);
  assertEquals(
    validateSummary({ ...good, summary: "One. Two things. Three things. Four things here. Five more. Six now. Seven." }),
    null,
  );
});

Deno.test("diagnostic wording is rejected, never shown", () => {
  for (const s of [
    "Your messages suggest a depressive disorder taking hold this week.",
    "This looks like clinical anxiety and may need a diagnosis.",
    "These are classic symptoms of burnout, and it was a hard day.",
    "A psychiatric review may help with what you are carrying today.",
  ]) {
    assertEquals(validateSummary({ ...good, summary: s }), null, s);
  }
});

Deno.test("ordinary feeling words are fine", () => {
  const s = "An anxious, low day. You felt overwhelmed by work and lonely in the evening, though talking it through helped a little.";
  assertEquals(validateSummary({ ...good, summary: s })?.summary, s);
});

Deno.test("the safety flag is carried through, and is false unless set true", () => {
  assertEquals(validateSummary({ ...good, safety: true })?.safety, true);
  assertEquals(validateSummary({ ...good, safety: "yes" })?.safety, false);
  assertEquals(validateSummary({ tone: good.tone, summary: good.summary })?.safety, false);
});

Deno.test("quotes and markdown around the summary are stripped", () => {
  assertEquals(validateSummary({ ...good, summary: `"**${good.summary}**"` })?.summary, good.summary);
});

Deno.test("garbage gives null, not a throw", () => {
  for (const junk of [null, undefined, "text", 3, [], {}]) assertEquals(validateSummary(junk), null);
});

// ─── the prompt ───────────────────────────────────────────────────

Deno.test("the system prompt carries the writing and safety rules", () => {
  for (const rule of ["second person", "diagnos", "light", "mixed", "heavy", "safety", "JSON"]) {
    assert(SYSTEM_PROMPT.toLowerCase().includes(rule.toLowerCase()), `missing: ${rule}`);
  }
});

Deno.test("the user prompt holds the messages in order, the feelings and the language", () => {
  const p = buildUserPrompt({
    messages: [m("1", "first thing", "2026-11-11T03:00:00Z"), m("2", "second thing", "2026-11-11T09:00:00Z")],
    feelings: ["anxiety"],
    languageName: "Hindi (Devanagari script)",
    isToday: false,
  });
  assert(p.indexOf("first thing") < p.indexOf("second thing"));
  assert(p.includes("anxiety") && p.includes("Hindi (Devanagari script)"));
});

Deno.test("a very long day keeps its latest messages within the budget", () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    m(String(i), `message number ${i} ${"x".repeat(60)}`, `2026-11-11T${String(Math.floor(i / 10)).padStart(2, "0")}:00:00Z`));
  const p = buildUserPrompt({ messages: many, feelings: [], languageName: "English", isToday: true });
  assert(p.length < 9000, `prompt is ${p.length} chars`);
  assert(p.includes("message number 199"), "latest message must be kept");
  assert(!p.includes("message number 0 "), "oldest messages are dropped first");
});

// ─── daily cap ────────────────────────────────────────────────────

Deno.test("the daily cap allows up to the limit, then refuses until the window rolls", () => {
  const t0 = new Date("2026-11-12T06:00:00Z");
  let state = null as { windowStart: string; count: number } | null;
  for (let i = 0; i < SUMMARY_CAP_PER_DAY; i++) {
    const r = nextRateWindow(state, t0);
    assertEquals(r.allowed, true);
    state = r.next;
  }
  assertEquals(nextRateWindow(state, t0).allowed, false);
  const later = new Date(t0.getTime() + 24 * 3600 * 1000 + 1000);
  const rolled = nextRateWindow(state, later);
  assertEquals(rolled.allowed, true);
  assertEquals(rolled.next.count, 1);
});
