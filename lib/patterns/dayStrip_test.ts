// Deno test (the app has no JS test runner): deno test lib/patterns/
// Excluded from tsc via tsconfig "exclude". Timestamps are built from
// local dates, so the tests pass in any time zone the machine is in.
import { assertEquals } from "jsr:@std/assert@1";
import {
  buildDayCells,
  defaultSelectedDay,
  lastNDays,
  localDayKey,
  neighbourDay,
  STRIP_DAYS,
} from "./dayStrip.ts";

/** An ISO timestamp for a local wall-clock time on this machine. */
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const today = new Date(2026, 10, 12, 10);

Deno.test("the strip is the last 30 days, oldest first, today last", () => {
  const days = lastNDays(today);
  assertEquals(STRIP_DAYS, 30);
  assertEquals(days.length, 30);
  assertEquals(days[0], "2026-10-14");
  assertEquals(days[29], "2026-11-12");
});

Deno.test("a local day key is the calendar date, zero-padded", () => {
  assertEquals(localDayKey(new Date(2026, 2, 5, 23, 59, 59)), "2026-03-05");
});

Deno.test("days are marked by whether you chatted, and by tone once summarised", () => {
  const cells = buildDayCells({
    today,
    chatTimestamps: [local(2026, 11, 10, 8), local(2026, 11, 10, 21), local(2026, 11, 12, 7)],
    summaries: [{ day: "2026-11-10", tone: "heavy" }],
  });
  const byDay = Object.fromEntries(cells.map((c) => [c.day, c]));
  assertEquals(byDay["2026-11-10"], { day: "2026-11-10", hasChats: true, tone: "heavy" });
  assertEquals(byDay["2026-11-12"], { day: "2026-11-12", hasChats: true, tone: null });
  assertEquals(byDay["2026-11-11"], { day: "2026-11-11", hasChats: false, tone: null });
});

Deno.test("a summary left over from a day with no messages shows no tone", () => {
  // Every message that day was deleted; the saved summary must not show.
  const cells = buildDayCells({ today, chatTimestamps: [], summaries: [{ day: "2026-11-09", tone: "light" }] });
  assertEquals(cells.find((c) => c.day === "2026-11-09")?.tone, null);
});

Deno.test("unknown tones and out-of-range timestamps are ignored", () => {
  const cells = buildDayCells({
    today,
    chatTimestamps: ["2025-01-01T00:00:00Z", "not a date"],
    summaries: [{ day: "2026-11-12", tone: "stormy" }],
  });
  assertEquals(cells.every((c) => !c.hasChats && c.tone === null), true);
});

Deno.test("the screen opens on the most recent day you chatted, else today", () => {
  const withChats = buildDayCells({ today, chatTimestamps: [local(2026, 11, 8, 9), local(2026, 11, 3, 9)], summaries: [] });
  assertEquals(defaultSelectedDay(withChats), "2026-11-08");
  const none = buildDayCells({ today, chatTimestamps: [], summaries: [] });
  assertEquals(defaultSelectedDay(none), "2026-11-12");
});

Deno.test("swiping moves one day and stops at either end", () => {
  const cells = buildDayCells({ today, chatTimestamps: [], summaries: [] });
  assertEquals(neighbourDay(cells, "2026-11-10", "older"), "2026-11-09");
  assertEquals(neighbourDay(cells, "2026-11-10", "newer"), "2026-11-11");
  assertEquals(neighbourDay(cells, "2026-11-12", "newer"), null);
  assertEquals(neighbourDay(cells, "2026-10-14", "older"), null);
  assertEquals(neighbourDay(cells, "1999-01-01", "older"), null);
});
