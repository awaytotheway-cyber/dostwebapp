// Deno test (the app has no JS test runner): deno test lib/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  aggregateListeningSummaries,
  describeListenedDuration,
  type ListeningSummaryRow,
} from "./journeyListening.ts";

function row(over: Partial<ListeningSummaryRow> = {}): ListeningSummaryRow {
  return {
    session_started_at: "2026-11-01T09:00:00Z",
    session_duration_seconds: 1800,
    speech_duration_seconds: 300,
    emotion_counts: { anxiety: 3, weariness: 1 },
    need_counts: { rest: 2 },
    inference_source: "mock",
    ...over,
  };
}

Deno.test("no sessions means no section at all, not an empty one", () => {
  assertEquals(aggregateListeningSummaries([]), null);
});

Deno.test("counts are summed across sessions and ranked", () => {
  const r = aggregateListeningSummaries([
    row({ emotion_counts: { anxiety: 3, weariness: 1 } }),
    row({ emotion_counts: { weariness: 5 } }),
  ])!;
  assertEquals(r.sessions, 2);
  assertEquals(r.topEmotions[0].token, "weariness");
  assertEquals(r.topEmotions[0].count, 6);
  assertEquals(r.topEmotions[1].token, "anxiety");
});

Deno.test("durations are summed and rounded", () => {
  const r = aggregateListeningSummaries([
    row({ session_duration_seconds: 1800.4, speech_duration_seconds: 300.5 }),
    row({ session_duration_seconds: 900, speech_duration_seconds: 120 }),
  ])!;
  assertEquals(r.listenedSeconds, 2700);
  assertEquals(r.speechSeconds, 421);
});

// THE QUARANTINE. This is the test that matters most: mocked
// arousal/valence must never be presentable, and the only switch that
// could make them presentable must stay off for every Phase 1-3 row.
Deno.test("mock rows never claim a real acoustic source", () => {
  assertEquals(aggregateListeningSummaries([row()])!.hasRealAcoustic, false);
});

Deno.test("one mock session taints the whole reflection", () => {
  const r = aggregateListeningSummaries([
    row({ inference_source: "acoustic_v1" }),
    row({ inference_source: "mock" }),
  ])!;
  assertEquals(r.hasRealAcoustic, false);
});

Deno.test("an unknown or missing source is not treated as real", () => {
  for (const src of [null, "", "v2", "ACOUSTIC_V1", "fused", "real"]) {
    const r = aggregateListeningSummaries([row({ inference_source: src })])!;
    assertEquals(r.hasRealAcoustic, false, `source ${JSON.stringify(src)}`);
  }
});

Deno.test("all-real sources do flip the switch, so Phase 4 can turn it on", () => {
  const r = aggregateListeningSummaries([
    row({ inference_source: "acoustic_v1" }),
    row({ inference_source: "fused_v1" }),
  ])!;
  assertEquals(r.hasRealAcoustic, true);
});

Deno.test("too few labels is marked sparse", () => {
  const thin = aggregateListeningSummaries([
    row({ emotion_counts: { anxiety: 1 }, need_counts: {} }),
  ])!;
  assert(thin.sparse);
  const enough = aggregateListeningSummaries([row()])!;
  assert(!enough.sparse);
});

// jsonb columns can hold anything, so a bad row must not poison the
// screen or get a vote.
Deno.test("malformed counts are dropped, not clamped or coerced", () => {
  const r = aggregateListeningSummaries([
    row({
      emotion_counts: {
        anxiety: 2,
        sadness: -5,
        anger: 0,
        shame: Number.NaN,
        guilt: Number.POSITIVE_INFINITY,
        fear: "lots" as unknown as number,
        "": 9,
        "  ": 4,
      },
    }),
  ])!;
  assertEquals(r.topEmotions.length, 1);
  assertEquals(r.topEmotions[0].token, "anxiety");
  assertEquals(r.topEmotions[0].count, 2);
});

Deno.test("numeric strings from jsonb still count", () => {
  const r = aggregateListeningSummaries([
    row({ emotion_counts: { anxiety: "3" as unknown as number } }),
  ])!;
  assertEquals(r.topEmotions[0].count, 3);
});

Deno.test("tokens are normalised and merged case-insensitively", () => {
  const r = aggregateListeningSummaries([
    row({ emotion_counts: { Anxiety: 2, " anxiety ": 1 } }),
  ])!;
  assertEquals(r.topEmotions.length, 1);
  assertEquals(r.topEmotions[0].token, "anxiety");
  assertEquals(r.topEmotions[0].count, 3);
});

Deno.test("ties break alphabetically so the order is stable", () => {
  const a = aggregateListeningSummaries([
    row({ emotion_counts: { weariness: 2, anxiety: 2 } }),
  ])!;
  const b = aggregateListeningSummaries([
    row({ emotion_counts: { anxiety: 2, weariness: 2 } }),
  ])!;
  assertEquals(a.topEmotions[0].token, b.topEmotions[0].token);
  assertEquals(a.topEmotions[0].token, "anxiety");
});

Deno.test("junk rows and junk columns do not throw", () => {
  const r = aggregateListeningSummaries([
    null as unknown as ListeningSummaryRow,
    row({ emotion_counts: null, need_counts: null }),
    row({ emotion_counts: [] as unknown as Record<string, unknown> }),
    row({ session_duration_seconds: null, speech_duration_seconds: null }),
    row({ session_duration_seconds: Number.NaN }),
  ])!;
  assert(r.sessions === 5);
  assert(Number.isFinite(r.listenedSeconds));
  assert(Number.isFinite(r.speechSeconds));
});

Deno.test("at most four emotions and needs are offered", () => {
  const many: Record<string, number> = {};
  for (let i = 0; i < 12; i++) many[`token_${i}`] = i + 1;
  const r = aggregateListeningSummaries([
    row({ emotion_counts: many, need_counts: many }),
  ])!;
  assertEquals(r.topEmotions.length, 4);
  assertEquals(r.topNeeds.length, 4);
  assertEquals(r.topEmotions[0].token, "token_11");
});

Deno.test("duration reads in minutes, then switches to hours", () => {
  assertEquals(describeListenedDuration(0), {
    key: "journey.listeningMinutes",
    amount: 1,
  });
  assertEquals(describeListenedDuration(90), {
    key: "journey.listeningMinutes",
    amount: 2,
  });
  assertEquals(describeListenedDuration(60 * 60), {
    key: "journey.listeningMinutes",
    amount: 60,
  });
  assertEquals(describeListenedDuration(60 * 60 * 2), {
    key: "journey.listeningHours",
    amount: 2,
  });
  // Never "0 minutes" for a session that really happened.
  assertEquals(describeListenedDuration(3).amount, 1);
});

Deno.test("neutral is never shown as something heard, and does not lift sparseness", () => {
  // Rows written by builds that counted it, and the classifier's own
  // "no feeling here" label, must not read as a feeling.
  const r = aggregateListeningSummaries([
    row({ emotion_counts: { neutral: 9, grief: 1 }, need_counts: { neutral: 2, support: 1 } }),
  ])!;
  assertEquals(r.topEmotions.map((t) => t.token), ["grief"]);
  assertEquals(r.topNeeds.map((t) => t.token), ["support"]);
  assertEquals(r.sparse, true);
});
