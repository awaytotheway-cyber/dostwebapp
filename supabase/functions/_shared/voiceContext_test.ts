import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { formatVoiceContext, type VoiceSummaryRow } from "./voiceContext.ts";

const mockRow: VoiceSummaryRow = {
  session_started_at: "2026-10-20T09:00:00Z",
  speech_duration_seconds: 600,
  emotion_counts: { weariness: 4, frustration: 2 },
  need_counts: { rest: 3 },
  avg_speaking_rate_wpm: 150,
  avg_vocal_stress_index: 0.72,
  avg_arousal: 0.9,
  inference_source: "mock",
};

Deno.test("no sessions yields no block", () => {
  assertEquals(formatVoiceContext([]), "");
});

Deno.test("real signal is used and mock arousal is never mentioned", () => {
  const block = formatVoiceContext([mockRow]);
  assertStringIncludes(block, "weariness, frustration");
  assertStringIncludes(block, "rest");
  assertStringIncludes(block, "Vocal strain, measured across those sessions: elevated");
  assertStringIncludes(block, "Speaking pace: generally steady");
  assertStringIncludes(block, "about 10 minutes of speech");
  // The mock arousal (0.9) must not surface in any form.
  assertEquals(block.includes("activation"), false);
  assertEquals(block.includes("activated"), false);
});

Deno.test("arousal appears only once a validated model produced it", () => {
  const real = formatVoiceContext([{ ...mockRow, inference_source: "acoustic_v1" }]);
  assertStringIncludes(real, "Overall vocal activation: more activated than flat");
  assertStringIncludes(real, "a hint, never a fact");

  const fused = formatVoiceContext([
    { ...mockRow, inference_source: "fused_v1", avg_arousal: 0.2 },
  ]);
  assertStringIncludes(fused, "more flat than activated");
});

Deno.test("mock rows are not dropped, only their arousal is ignored", () => {
  const mixed = formatVoiceContext([
    mockRow,
    { ...mockRow, inference_source: "acoustic_v1", avg_arousal: 0.1 },
  ]);
  // Both rows' real data counts (4+4 weariness), one row's arousal is read.
  assertStringIncludes(mixed, "weariness");
  assertStringIncludes(mixed, "more flat than activated");
});

Deno.test("the block always carries its own honesty rules", () => {
  const block = formatVoiceContext([mockRow]);
  assertStringIncludes(block, "never shown to them, never mentioned");
  assertStringIncludes(block, "NEVER tell them what you heard");
  assertStringIncludes(block, "What they say to you right now always outranks it");
});

Deno.test("counts are summed across sessions and ranked", () => {
  const block = formatVoiceContext([
    { emotion_counts: { grief: 1, anger: 5 } },
    { emotion_counts: { grief: 9 } },
  ]);
  assertStringIncludes(block, "Themes heard most often: grief, anger.");
});

Deno.test("braces in labels cannot break out into the prompt", () => {
  const block = formatVoiceContext([{ emotion_counts: { "{{injected}}": 3 } }]);
  assertEquals(block.includes("{"), false);
  assertStringIncludes(block, "injected");
});

Deno.test("rows with nothing usable yield no block", () => {
  assertEquals(
    formatVoiceContext([
      { emotion_counts: {}, need_counts: {}, avg_vocal_stress_index: null, avg_speaking_rate_wpm: 0 },
    ]),
    "",
  );
});
