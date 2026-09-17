/** Emotional patterns the user may select before chatting. Not diagnoses. */

export const EMOTIONAL_STATES = [
  { token: 'shame', label: 'Shame' },
  { token: 'anger_grief', label: 'Anger & grief' },
  { token: 'multipersona', label: 'Mixed parts' },
  { token: 'shielding_manager', label: 'Shielding' },
  { token: 'victim_personality', label: 'Powerless pattern' },
  { token: 'resignation', label: 'Resignation' },
  { token: 'denial', label: 'Denial' },
  { token: 'envy', label: 'Envy' },
  { token: 'pride', label: 'Pride' },
  { token: 'greed', label: 'Grasping' },
  { token: 'lust', label: 'Craving' },
  { token: 'addiction', label: 'Pull / habit' },
  { token: 'detachment', label: 'Detachment' },
  { token: 'spiritual_bypass', label: 'Spiritual bypass' },
  { token: 'scarcity', label: 'Scarcity' },
  { token: 'lamentation', label: 'Lamentation' },
] as const;

export type EmotionalStateToken = (typeof EMOTIONAL_STATES)[number]['token'];

const ALLOWED = new Set<string>(EMOTIONAL_STATES.map((s) => s.token));

export function isEmotionalStateToken(value: unknown): value is EmotionalStateToken {
  return typeof value === 'string' && ALLOWED.has(value);
}

export function labelForEmotionalState(token: EmotionalStateToken): string {
  const found = EMOTIONAL_STATES.find((s) => s.token === token);
  return found?.label ?? token;
}

/** Short plain-English hints shown under each option (patterns, not diagnoses). */
export const EMOTIONAL_STATE_HINTS: Record<EmotionalStateToken, string> = {
  shame: 'A sense of not being enough',
  anger_grief: 'Heat, hurt, or loss under the surface',
  multipersona: 'Different parts pulling in different ways',
  shielding_manager: 'Pleasing or controlling to stay safe',
  victim_personality: 'Feeling powerless or repeatedly wronged',
  resignation: 'A quiet "what\'s the point"',
  denial: 'Keeping distance from what is hard',
  envy: 'Wanting what someone else seems to have',
  pride: 'Needing to handle it alone',
  greed: 'Grasping or never feeling full',
  lust: 'Strong craving or longing',
  addiction: 'A pull that is hard to put down',
  detachment: 'Numbing or stepping back from feeling',
  spiritual_bypass: 'Using higher language to skip the feeling',
  scarcity: 'Believing there is not enough to go around',
  lamentation: 'Deep sorrow for what was lost or never was',
};

/**
 * Display labels for server-extracted emotion tokens (coverings + everyday feelings).
 * Used when surfacing tags; picker still uses EMOTIONAL_STATES only.
 */
export const EXTRACTED_EMOTION_LABELS: Record<string, string> = {
  shame: 'Shame',
  anger_grief: 'Anger & grief',
  multipersona: 'Mixed parts',
  shielding_manager: 'Shielding',
  victim_personality: 'Powerless pattern',
  resignation: 'Resignation',
  denial: 'Denial',
  envy: 'Envy',
  pride: 'Pride',
  greed: 'Grasping',
  lust: 'Craving',
  addiction: 'Pull / habit',
  detachment: 'Detachment',
  spiritual_bypass: 'Spiritual bypass',
  scarcity: 'Scarcity',
  lamentation: 'Lamentation',
  inadequacy: 'Inadequacy',
  loneliness: 'Loneliness',
  resentment: 'Resentment',
  guilt: 'Guilt',
  fear: 'Fear',
  anxiety: 'Anxiety',
  grief: 'Grief',
  anger: 'Anger',
  helplessness: 'Helplessness',
  overwhelm: 'Overwhelm',
  numbness: 'Numbness',
  disappointment: 'Disappointment',
  frustration: 'Frustration',
  confusion: 'Confusion',
  emptiness: 'Emptiness',
  betrayal: 'Betrayal',
  abandonment: 'Abandonment',
  humiliation: 'Humiliation',
  embarrassment: 'Embarrassment',
  jealousy: 'Jealousy',
  invisibility: 'Invisibility',
  sadness: 'Sadness',
  weariness: 'Weariness',
  hurt: 'Hurt',
  longing: 'Longing',
  disgust: 'Disgust',
  contempt: 'Contempt',
};

export const EXTRACTED_NEED_LABELS: Record<string, string> = {
  safety: 'Safety',
  autonomy: 'Autonomy',
  recognition: 'Recognition',
  belonging: 'Belonging',
  authenticity: 'Authenticity',
  meaning: 'Meaning',
  growth: 'Growth',
  peace: 'Peace',
  connection: 'Connection',
  respect: 'Respect',
  competence: 'Competence',
  acceptance: 'Acceptance',
  self_acceptance: 'Self-acceptance',
  freedom: 'Freedom',
  understanding: 'Understanding',
  empathy: 'Empathy',
  support: 'Support',
  trust: 'Trust',
  fairness: 'Fairness',
  dignity: 'Dignity',
  purpose: 'Purpose',
  love: 'Love',
  reciprocity: 'Reciprocity',
  consideration: 'Consideration',
  being_seen: 'Being seen',
  being_heard: 'Being heard',
  being_enough: 'Being enough',
};

export function labelForExtractedEmotion(token: string): string {
  return EXTRACTED_EMOTION_LABELS[token] ?? token.replace(/_/g, ' ');
}

export function labelForExtractedNeed(token: string): string {
  return EXTRACTED_NEED_LABELS[token] ?? token.replace(/_/g, ' ');
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
