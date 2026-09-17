import {
  computeThemeRepeatCount,
  determineStage,
  isIntegrationMessage,
  resolveTurnStage,
} from "./conversationStage.ts";
import { generateSuggestionChips } from "./suggestionChips.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("determineStage: first message is meeting", () => {
  assert(
    determineStage([], "I didn't like when my boss said I'm taking too long.") ===
      "meeting",
    "first turn should be meeting",
  );
});

Deno.test("determineStage: second message without chip is naming_emotion", () => {
  const rows = [
    {
      selected_emotion: null,
      selected_need: null,
      conversation_stage: "meeting",
    },
  ];
  assert(
    determineStage(rows, "My stomach tightened.") === "naming_emotion",
    "second turn without selected emotion should be naming_emotion",
  );
});

Deno.test("determineStage: farewell closes conversation", () => {
  const rows = [
    {
      selected_emotion: "shame",
      selected_need: "recognition",
      conversation_stage: "exploring_origin",
    },
  ];
  assert(
    determineStage(rows, "thanks, gotta go.") === "closed",
    "farewell should close",
  );
});

Deno.test("determineStage: integration phrase", () => {
  const rows = [
    {
      selected_emotion: "shame",
      selected_need: "being_enough",
      conversation_stage: "surfacing_myth",
    },
  ];
  assert(
    determineStage(rows, "okay, I'll try that.") === "integration",
    "okay I'll try that should integrate",
  );
  assert(
    isIntegrationMessage("okay, I'll try that."),
    "isIntegrationMessage helper",
  );
});

Deno.test("generateSuggestionChips: closed and integration return empty", () => {
  for (const stage of ["closed", "integration"] as const) {
    const chips = generateSuggestionChips({
      conversation_stage: stage,
      primary_emotion: "shame",
      selected_emotion: "shame",
    });
    assert(
      chips.suggested_emotions.length === 0 && chips.suggested_needs.length === 0,
      `${stage} should have no chips`,
    );
  }
});

Deno.test("generateSuggestionChips: need chips require naming_need + selected emotion", () => {
  const chips = generateSuggestionChips({
    conversation_stage: "naming_need",
    selected_emotion: "shame",
  });
  assert(chips.suggested_needs.includes("being_enough"), "shame maps to being_enough");
  assert(chips.suggested_emotions.length === 0, "no emotion chips at naming_need");
});

Deno.test("resolveTurnStage: emotion chip advances to naming_need", () => {
  assert(
    resolveTurnStage("naming_emotion", {
      selectedEmotion: "shame",
      selectedNeed: null,
    }) === "naming_need",
    "emotion chip should advance to naming_need",
  );
});

Deno.test("computeThemeRepeatCount: increments on same emotion", () => {
  const rows = [
    { primary_emotion: "shame" },
    { primary_emotion: "shame" },
  ];
  assert(
    computeThemeRepeatCount(rows, "shame") === 3,
    "third repeat of shame should be 3",
  );
});
