import { hasMessage, t, type TKey } from './i18n';

/** Emotional patterns the user may select before chatting. Not diagnoses. */

export const EMOTIONAL_STATES = [
  'shame',
  'anger_grief',
  'multipersona',
  'shielding_manager',
  'victim_personality',
  'resignation',
  'denial',
  'envy',
  'pride',
  'greed',
  'lust',
  'addiction',
  'detachment',
  'spiritual_bypass',
  'scarcity',
  'lamentation',
] as const;

export type EmotionalStateToken = (typeof EMOTIONAL_STATES)[number];

const ALLOWED = new Set<string>(EMOTIONAL_STATES);

export function isEmotionalStateToken(value: unknown): value is EmotionalStateToken {
  return typeof value === 'string' && ALLOWED.has(value);
}

export function labelForEmotionalState(token: EmotionalStateToken): string {
  return t(`emotions.${token}` as TKey);
}

/** Short plain-language hint shown under each option (patterns, not diagnoses). */
export function hintForEmotionalState(token: EmotionalStateToken): string {
  return t(`emotionHints.${token}` as TKey);
}

/**
 * Display labels for server-extracted emotion and need tokens (coverings +
 * everyday feelings). Unknown tokens fall back to the token itself.
 */
export function labelForExtractedEmotion(token: string): string {
  const key = `emotions.${token}`;
  return hasMessage(key) ? t(key as TKey) : token.replace(/_/g, ' ');
}

export function labelForExtractedNeed(token: string): string {
  const key = `needs.${token}`;
  return hasMessage(key) ? t(key as TKey) : token.replace(/_/g, ' ');
}

/**
 * Shape stored by extract-emotions / message_emotions (server).
 * Client UI currently only uses picker tokens above; this documents the enriched row
 * for Step 4 metrics / future reflection surfaces.
 *
 * Ops metrics (no message text): view `message_emotions_quality_metrics`
 * (avg confidence, ambiguous_rate per user/day). Edge logs also emit
 * confidence + ambiguous|clear on extract-emotions / chat.
 */
export type ConversationStage =
  | 'meeting'
  | 'naming_emotion'
  | 'naming_need'
  | 'exploring_origin'
  | 'surfacing_myth'
  | 'challenging_belief'
  | 'integration'
  | 'closed';

export type MessageEmotionRecord = {
  primary_emotion: string;
  primary_emotions: string[];
  secondary_emotions: string[];
  underlying_need: string;
  needs: string[];
  emotion_intensities: Record<string, number>;
  confidence_score: number;
  is_ambiguous: boolean;
  explanation: string | null;
  conversation_stage: ConversationStage;
  suggested_emotions: string[];
  suggested_needs: string[];
  selected_emotion: string | null;
  selected_need: string | null;
  theme_repeat_count: number;
};
