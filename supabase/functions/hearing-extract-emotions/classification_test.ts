// Deno test: deno test supabase/functions/hearing-extract-emotions/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ALLOWED_EMOTIONS,
  normaliseClassification,
  SYSTEM_PROMPT,
} from "./classification.ts";

Deno.test("a clear reading passes through", () => {
  assertEquals(
    normaliseClassification({
      primary_emotion: "Grief",
      secondary_emotions: ["weariness", "grief", "loneliness", "fear"],
      underlying_need: "support",
      semantic_confidence: 0.82,
    }),
    {
      primary_emotion: "grief",
      secondary_emotions: ["weariness", "loneliness"],
      underlying_need: "support",
      semantic_confidence: 0.82,
    },
  );
});

Deno.test("neutral is a real answer, and carries no secondaries and no need", () => {
  assertEquals(
    normaliseClassification({
      primary_emotion: "neutral",
      secondary_emotions: ["anxiety"],
      underlying_need: "understanding",
      semantic_confidence: 0.9,
    }),
    {
      primary_emotion: "neutral",
      secondary_emotions: [],
      underlying_need: null,
      semantic_confidence: 0.9,
    },
  );
});

Deno.test("an invented emotion becomes low-confidence neutral, never detachment", () => {
  // It used to become "detachment" while keeping the model's own,
  // possibly high, confidence — a confident label nobody gave.
  const out = normaliseClassification({
    primary_emotion: "joy",
    secondary_emotions: [],
    underlying_need: "connection",
    semantic_confidence: 0.95,
  });
  assertEquals(out.primary_emotion, "neutral");
  assertEquals(out.underlying_need, null);
  assertEquals(out.secondary_emotions, []);
  assert(out.semantic_confidence <= 0.4);
});

Deno.test("an invented need is dropped rather than replaced", () => {
  const out = normaliseClassification({
    primary_emotion: "fear",
    underlying_need: "comfort",
    semantic_confidence: 0.7,
  });
  assertEquals(out.primary_emotion, "fear");
  assertEquals(out.underlying_need, null);
});

Deno.test("neutral never appears among the secondaries", () => {
  const out = normaliseClassification({
    primary_emotion: "anger",
    secondary_emotions: ["neutral", "hurt"],
    underlying_need: "respect",
    semantic_confidence: 0.6,
  });
  assertEquals(out.secondary_emotions, ["hurt"]);
});

Deno.test("confidence is clamped, and a missing one is treated as unsure", () => {
  assertEquals(
    normaliseClassification({ primary_emotion: "fear", semantic_confidence: 7 }).semantic_confidence,
    1,
  );
  assertEquals(
    normaliseClassification({ primary_emotion: "fear", semantic_confidence: -1 }).semantic_confidence,
    0,
  );
  assert(normaliseClassification({ primary_emotion: "fear" }).semantic_confidence < 0.5);
});

Deno.test("garbage input gives low-confidence neutral, not a throw", () => {
  for (const junk of [null, undefined, "text", 42, [], {}]) {
    const out = normaliseClassification(junk);
    assertEquals(out.primary_emotion, "neutral");
    assertEquals(out.underlying_need, null);
    assert(out.semantic_confidence <= 0.4);
  }
});

Deno.test("the prompt offers neutral and no longer steers unclear speech to detachment", () => {
  assert(ALLOWED_EMOTIONS.has("neutral"));
  assert(SYSTEM_PROMPT.includes('"neutral"'));
  assert(!/unclear[^.]*detachment/.test(SYSTEM_PROMPT));
});
