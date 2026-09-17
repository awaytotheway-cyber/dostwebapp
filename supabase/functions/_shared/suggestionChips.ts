/** DOST suggestion chip generator — keep in sync with lib/dost/suggestionChips.ts (Step 7 wires chat). */

const EMOTION_TO_LIKELY_NEEDS: Record<string, string[]> = {
  shame: ["belonging", "acceptance", "competence", "being_enough"],
  anger_grief: ["understanding", "respect", "support", "fairness"],
  denial: ["safety", "peace", "autonomy", "understanding"],
  resignation: ["meaning", "autonomy", "support", "peace"],
  victim_personality: ["fairness", "recognition", "support", "safety"],
  scarcity: ["trust", "safety", "peace", "connection"],
  lamentation: ["understanding", "connection", "being_heard", "empathy"],
  pride: ["recognition", "respect", "autonomy", "being_seen"],
  envy: ["fairness", "recognition", "belonging", "growth"],
  lust: ["connection", "freedom", "growth", "love"],
  greed: ["safety", "trust", "peace", "competence"],
  addiction: ["peace", "freedom", "empathy", "support"],
  detachment: ["safety", "peace", "autonomy", "understanding"],
  spiritual_bypass: ["peace", "meaning", "safety", "empathy"],
  multipersona: ["authenticity", "understanding", "safety", "belonging"],
  shielding_manager: ["safety", "autonomy", "acceptance", "recognition"],
  default: ["safety", "understanding", "connection", "peace"],
};

function generateEmotionChips(
  primaryEmotion: string,
  secondaryEmotions: string[],
  _confidence: number,
): string[] {
  const chips = [primaryEmotion, ...secondaryEmotions].filter(Boolean);
  const uniqueChips = [...new Set(chips)].slice(0, 4);
  return uniqueChips;
}

function generateNeedChips(selectedEmotion: string): string[] {
  return EMOTION_TO_LIKELY_NEEDS[selectedEmotion] ??
    EMOTION_TO_LIKELY_NEEDS.default;
}

export type Stage =
  | "meeting"
  | "naming_emotion"
  | "naming_need"
  | "exploring_origin"
  | "surfacing_myth"
  | "challenging_belief"
  | "integration"
  | "closed";

export function generateSuggestionChips(params: {
  conversation_stage: Stage;
  primary_emotion?: string;
  secondary_emotions?: string[];
  confidence_score?: number;
  selected_emotion?: string | null;
}): { suggested_emotions: string[]; suggested_needs: string[] } {
  const {
    conversation_stage,
    primary_emotion,
    secondary_emotions,
    confidence_score,
    selected_emotion,
  } = params;

  if (conversation_stage === "naming_emotion" && primary_emotion) {
    return {
      suggested_emotions: generateEmotionChips(
        primary_emotion,
        secondary_emotions ?? [],
        confidence_score ?? 0,
      ),
      suggested_needs: [],
    };
  }
  if (conversation_stage === "naming_need" && selected_emotion) {
    return {
      suggested_emotions: [],
      suggested_needs: generateNeedChips(selected_emotion),
    };
  }
  return { suggested_emotions: [], suggested_needs: [] };
}
