/**
 * The classifier's prompt, and the rules for turning whatever the model
 * returns into tags the hearing pipeline may store. Pure, so it can be
 * tested without a server or an API key.
 *
 * NEUTRAL. A listening session overhears ordinary life — logistics, small
 * talk, reading aloud — and almost none of the taxonomy below is a
 * neutral or easy feeling. Without a way to say "no feeling here", every
 * passage had to be forced into one, and unclear passages were told to
 * answer "detachment". "neutral" is that way out. It is stored on the
 * signal row and never counted or shown as a feeling (HIDDEN_EMOTIONS in
 * lib/hearing/sessionSummary.ts); the device also ignores any label below
 * confidence 0.5.
 */

/** Feelings that may be counted, as primary or secondary. */
export const FEELINGS: ReadonlySet<string> = new Set([
  "shame", "anger_grief", "multipersona", "shielding_manager",
  "victim_personality", "resignation", "denial", "envy", "pride", "greed",
  "lust", "addiction", "detachment", "spiritual_bypass", "scarcity",
  "lamentation", "inadequacy", "loneliness", "resentment", "guilt", "fear",
  "anxiety", "grief", "anger", "helplessness", "overwhelm", "numbness",
  "disappointment", "frustration", "confusion", "emptiness", "betrayal",
  "abandonment", "humiliation", "embarrassment", "jealousy", "invisibility",
  "sadness", "weariness", "hurt", "longing", "disgust", "contempt",
]);

export const NEUTRAL = "neutral";

/** What primary_emotion may be: a feeling, or neutral. */
export const ALLOWED_EMOTIONS: ReadonlySet<string> = new Set([...FEELINGS, NEUTRAL]);

export const ALLOWED_NEEDS: ReadonlySet<string> = new Set([
  "safety", "autonomy", "recognition", "belonging", "authenticity",
  "meaning", "growth", "peace", "connection", "respect", "competence",
  "acceptance", "self_acceptance", "freedom", "understanding", "empathy",
  "support", "trust", "fairness", "dignity", "purpose", "love",
  "reciprocity", "consideration", "being_seen", "being_heard", "being_enough",
]);

/** The confidence given to an answer the model did not really give. */
const UNSURE = 0.4;

export const SYSTEM_PROMPT =
  `You classify one short spoken passage against DOST's emotion taxonomy and NVC needs list.

The passage was picked up by the person's own phone during a listening
session. It was not written to you. Much of what people say in a day
carries no feeling at all — logistics, small talk, reading aloud — and
you must not force a feeling onto it.

The passage may be in English, Hindi, Marathi, or mix these languages
(code-switching is normal). It may be in Devanagari script or
Roman-transliterated. Understand the passage in whatever language it
arrives in, and return your answer using the English allowlisted
tokens below — the tokens are the taxonomy, not translations of the
passage.

Return a single JSON object with these fields, and nothing else:
  primary_emotion       ONE token from the allowed emotions list, or "${NEUTRAL}"
  secondary_emotions    up to 2 additional tokens from the allowed emotions list (may be empty)
  underlying_need       ONE token from the allowed needs list, or null
  semantic_confidence   a number 0..1 — how sure you are the words express this feeling

Rules:
  - Name a feeling only when the words themselves express it. When in doubt, answer "${NEUTRAL}".
  - Answer "${NEUTRAL}" when the passage carries no clear feeling, or is too short or garbled to tell. With "${NEUTRAL}", return secondary_emotions [] and underlying_need null.
  - Use allowlisted tokens exactly. Do not invent tokens.
  - The passage may contain placeholders like [phone] [email] [address]. Treat them as opaque.
  - Never quote names, events, phone numbers, or emails back to the caller.
  - Never echo the passage's own words — return only tokens.

Allowed emotions: ${[...FEELINGS].join(", ")}
Allowed needs:    ${[...ALLOWED_NEEDS].join(", ")}`;

export type HearingClassification = {
  primary_emotion: string;
  secondary_emotions: string[];
  underlying_need: string | null;
  semantic_confidence: number;
};

function coerceToken(v: unknown, allowed: ReadonlySet<string>): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t && allowed.has(t) ? t : null;
}

function coerceConfidence(v: unknown): number {
  if (v === null || v === undefined || v === "") return UNSURE;
  const n = Number(v);
  if (!Number.isFinite(n)) return UNSURE;
  return Math.max(0, Math.min(1, n));
}

function secondaries(v: unknown, primary: string): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = coerceToken(item, FEELINGS);
    if (t && t !== primary && !out.includes(t)) out.push(t);
    if (out.length === 2) break;
  }
  return out;
}

/** The model's parsed JSON → tags the device may store. Never throws. */
export function normaliseClassification(parsed: unknown): HearingClassification {
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const confidence = coerceConfidence(obj.semantic_confidence);
  const primary = coerceToken(obj.primary_emotion, ALLOWED_EMOTIONS);

  // No usable answer: say so, rather than inventing a feeling — and never
  // keep a confidence the model attached to a token it made up.
  if (!primary) {
    return {
      primary_emotion: NEUTRAL,
      secondary_emotions: [],
      underlying_need: null,
      semantic_confidence: Math.min(confidence, UNSURE),
    };
  }
  if (primary === NEUTRAL) {
    return {
      primary_emotion: NEUTRAL,
      secondary_emotions: [],
      underlying_need: null,
      semantic_confidence: confidence,
    };
  }
  return {
    primary_emotion: primary,
    secondary_emotions: secondaries(obj.secondary_emotions, primary),
    underlying_need: coerceToken(obj.underlying_need, ALLOWED_NEEDS),
    semantic_confidence: confidence,
  };
}
