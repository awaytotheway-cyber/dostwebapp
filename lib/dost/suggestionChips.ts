/** DOST suggestion chip generator — keep in sync with supabase/functions/_shared/suggestionChips.ts (Step 7 wires chat). */

import {
  labelForExtractedEmotion,
  labelForExtractedNeed,
  type ConversationStage,
} from '../emotionalStates';

export type { ConversationStage as Stage } from '../emotionalStates';

const EMOTION_TO_LIKELY_NEEDS: Record<string, string[]> = {
  shame: ['belonging', 'acceptance', 'competence', 'being_enough'],
  anger_grief: ['understanding', 'respect', 'support', 'fairness'],
  denial: ['safety', 'peace', 'autonomy', 'understanding'],
  resignation: ['meaning', 'autonomy', 'support', 'peace'],
  victim_personality: ['fairness', 'recognition', 'support', 'safety'],
  scarcity: ['trust', 'safety', 'peace', 'connection'],
  lamentation: ['understanding', 'connection', 'being_heard', 'empathy'],
  pride: ['recognition', 'respect', 'autonomy', 'being_seen'],
  envy: ['fairness', 'recognition', 'belonging', 'growth'],
  lust: ['connection', 'freedom', 'growth', 'love'],
  greed: ['safety', 'trust', 'peace', 'competence'],
  addiction: ['peace', 'freedom', 'empathy', 'support'],
  detachment: ['safety', 'peace', 'autonomy', 'understanding'],
  spiritual_bypass: ['peace', 'meaning', 'safety', 'empathy'],
  multipersona: ['authenticity', 'understanding', 'safety', 'belonging'],
  shielding_manager: ['safety', 'autonomy', 'acceptance', 'recognition'],
  default: ['safety', 'understanding', 'connection', 'peace'],
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
  return EMOTION_TO_LIKELY_NEEDS[selectedEmotion] ?? EMOTION_TO_LIKELY_NEEDS.default;
}

export function generateSuggestionChips(params: {
  conversation_stage: ConversationStage;
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

  if (conversation_stage === 'naming_emotion' && primary_emotion) {
    return {
      suggested_emotions: generateEmotionChips(
        primary_emotion,
        secondary_emotions ?? [],
        confidence_score ?? 0,
      ),
      suggested_needs: [],
    };
  }
  if (conversation_stage === 'naming_need' && selected_emotion) {
    return {
      suggested_emotions: [],
      suggested_needs: generateNeedChips(selected_emotion),
    };
  }
  return { suggested_emotions: [], suggested_needs: [] };
}

/** Human-readable label for an emotion chip token. */
export function labelForEmotionChip(token: string): string {
  return labelForExtractedEmotion(token);
}

/** Human-readable label for a need chip token. */
export function labelForNeedChip(token: string): string {
  return labelForExtractedNeed(token);
}
