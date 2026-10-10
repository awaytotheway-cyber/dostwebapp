/**
 * "Tame the Mind — Name your Feelings" vocabulary straight from the
 * mentor's "Additional instructions for the BOT" document.
 *
 * Mirror of supabase/functions/_shared/mentorBoxes.ts. Kept client-side
 * so UI surfaces (future chip rows, Journey vocabulary) can draw from
 * the same list.
 */

export const BOX1_UNMET_FEELINGS = [
  'afraid', 'discouraged', 'hopeless', 'sad',
  'anxious', 'disappointed', 'infuriated', 'sceptical',
  'angry', 'distant', 'insecure', 'suspicious',
  'annoyed', 'embarrassed', 'impatient', 'scared',
  'agitated', 'enraged', 'irritated', 'torn',
  'apathetic', 'fearful', 'lonely', 'troubled',
  'bored', 'frustrated', 'mad', 'uneasy',
  'bitter', 'furious', 'miserable', 'uncomfortable',
  'concerned', 'hesitant', 'nervous', 'upset',
  'confused', 'hurt', 'numb', 'uninterested',
  'depressed', 'horrified', 'reluctant', 'worried',
] as const;

export const BOX2_MET_FEELINGS = [
  'adventurous', 'delighted', 'joyful', 'stimulated',
  'alert', 'eager', 'loving', 'strong',
  'alive', 'enthusiastic', 'motivated', 'surprised',
  'amazed', 'encouraged', 'moved', 'thrilled',
  'amused', 'excited', 'nurtured', 'touched',
  'appreciative', 'fascinated', 'open', 'thankful',
  'at ease', 'fulfilled', 'peaceful',
  'calm', 'glad', 'relieved',
  'clear', 'grateful', 'relaxed',
  'comfortable', 'happy', 'rested',
  'confident', 'hopeful', 'refreshed',
  'content', 'inspired', 'satisfied',
  'connected', 'invigorated', 'safe',
  'curious', 'interested', 'secure',
] as const;

export const BOX3_UNIVERSAL_NEEDS = [
  'acceptance', 'connection', 'inspiration', 'respect',
  'appreciation', 'consideration', 'integration', 'rest',
  'authenticity', 'contribution', 'integrity', 'safety',
  'acknowledgment', 'creativity', 'joy', 'service',
  'awareness', 'dignity', 'kindness', 'space',
  'balance', 'ease', 'learning', 'spontaneity',
  'beauty', 'effectiveness', 'love', 'stimulation',
  'belonging', 'empathy', 'making a difference', 'self-expression',
  'care', 'equality', 'meaning', 'support',
  'celebration', 'encouragement', 'mourning', 'shelter',
  'choice', 'empowerment', 'movement', 'security',
  'challenge', 'food', 'mutuality', 'self care',
  'clarity', 'freedom', 'nurturance', 'self acceptance',
  'cooperation', 'grace', 'order', 'self compassion',
  'consciousness', 'growth', 'participation', 'self empathy',
  'competence', 'harmony', 'peace', 'spirituality',
  'compassion', 'honesty', 'play', 'tenderness',
  'comfort', 'honouring the sacred', 'purpose', 'to be heard',
  'community', 'humour', 'reassurance', 'trust',
  'companionship', 'inclusion', 'reciprocity', 'understanding',
  'values',
] as const;

export type Box1Feeling = (typeof BOX1_UNMET_FEELINGS)[number];
export type Box2Feeling = (typeof BOX2_MET_FEELINGS)[number];
export type Box3Need = (typeof BOX3_UNIVERSAL_NEEDS)[number];

export function buildMentorBoxesSection(): string {
  return [
    'NAMING PALETTE (use these exact words when you offer a name — never improvise outside these lists):',
    '',
    '— Feelings when a need is NOT met (Box 1):',
    BOX1_UNMET_FEELINGS.join(', ') + '.',
    '',
    '— Feelings when a need IS met (Box 2):',
    BOX2_MET_FEELINGS.join(', ') + '.',
    '',
    '— Universal needs (Box 3):',
    BOX3_UNIVERSAL_NEEDS.join(', ') + '.',
    '',
    "When the stage is naming_emotion, offer up to three feeling words from Box 1 or Box 2 that honestly fit — never a word outside these lists. When the stage is naming_need, offer up to three need words from Box 3 — same rule. Offer, do not label. Keep to the mentor's words so the user builds a shared vocabulary over time.",
  ].join('\n');
}
