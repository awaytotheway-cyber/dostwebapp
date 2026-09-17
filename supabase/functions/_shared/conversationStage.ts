/** Conversation stage detection — keep logic in sync with extract-emotions + chat. */

export type Stage =
  | "meeting"
  | "naming_emotion"
  | "naming_need"
  | "exploring_origin"
  | "surfacing_myth"
  | "challenging_belief"
  | "integration"
  | "closed";

export type StageRow = {
  selected_emotion: string | null;
  selected_need: string | null;
  conversation_stage: string;
};

export type RecentStageRow = StageRow & {
  primary_emotion: string | null;
};

const FAREWELL_PATTERN =
  /\b(bye|goodbye|thanks|thank you|gotta go|talk later|see you)\b/i;

/** Short acceptance phrases that signal integration — hold space, no follow-up. */
export function isIntegrationMessage(text: string): boolean {
  const trimmed = text.trim();
  if (/^\s*(okay|ok|maybe|i guess|alright)\.?\s*$/i.test(trimmed)) {
    return true;
  }
  if (/^\s*(okay|ok),?\s+i(?:'ll| will) try\b/i.test(trimmed)) {
    return true;
  }
  if (/^\s*i(?:'ll| will) try\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function isFarewellMessage(text: string): boolean {
  return FAREWELL_PATTERN.test(text);
}

export function determineStage(
  recentRows: StageRow[],
  currentMessageText: string,
): Stage {
  if (isFarewellMessage(currentMessageText) && recentRows.length > 0) {
    return "closed";
  }

  if (isIntegrationMessage(currentMessageText)) {
    return "integration";
  }

  if (recentRows.length === 0) return "meeting";

  const hasSelectedEmotion = recentRows.some((r) => r.selected_emotion);
  const hasSelectedNeed = recentRows.some((r) => r.selected_need);
  const turnsInConversation = recentRows.length;

  if (!hasSelectedEmotion) return "naming_emotion";
  if (!hasSelectedNeed) return "naming_need";
  if (turnsInConversation < 5) return "exploring_origin";
  if (turnsInConversation < 8) return "surfacing_myth";
  return "challenging_belief";
}

/** Adjust stage when the user just tapped a suggestion chip on this turn. */
export function resolveTurnStage(
  extractedStage: Stage,
  chipSelection: {
    selectedEmotion: string | null;
    selectedNeed: string | null;
  },
): Stage {
  if (extractedStage === "closed" || extractedStage === "integration") {
    return extractedStage;
  }
  if (chipSelection.selectedNeed) {
    return "exploring_origin";
  }
  if (chipSelection.selectedEmotion) {
    return "naming_need";
  }
  return extractedStage;
}

export function computeThemeRepeatCount(
  recentRows: Array<{ primary_emotion: string | null }>,
  primaryEmotion: string,
): number {
  let priorMatches = 0;
  for (const row of recentRows) {
    if (row.primary_emotion === primaryEmotion) priorMatches++;
  }
  return priorMatches + 1;
}
