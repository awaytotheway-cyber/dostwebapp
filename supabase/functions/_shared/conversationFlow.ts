/**
 * Per-turn conversation guidance — what keeps DOST from asking the same
 * kind of question every turn.
 *
 * Pure functions only (no I/O) so chat/index.ts can use them and the
 * Deno tests can pin them down. Grounded in the mentor's documents:
 *
 *  - "Additional instructions for the BOT": lead from the user's choice
 *    of words → name the feeling (Boxes 1/2) → name the need (Box 3) →
 *    surface the myth → challenge it in small doses; never let the user
 *    only sit with an unnamed feeling; Should / Should not / But carry
 *    shame; the mind's voice (loud, urgent) vs the Self's voice (soft,
 *    once, gives choice); observation vs evaluation; SPLACE requests.
 *  - "The 2-way Conscious communicator": pick up cues from the person's
 *    words and their repetitions; mirror, clarify and offer insight
 *    rather than advise; keep going "5-why" style without sounding like
 *    an investigator; take permission before any suggestion.
 *  - "DOST INSTRUCTIONS": never the same phrasing twice, one question
 *    at most, silence over stimulation, let people go when they leave.
 */

import {
  BOX1_UNMET_FEELINGS,
  BOX2_MET_FEELINGS,
  BOX3_UNIVERSAL_NEEDS,
} from "./mentorBoxes.ts";
import type { Stage } from "./conversationStage.ts";

/** A gap this long between messages starts a new conversation. */
export const CONVERSATION_GAP_MS = 3 * 60 * 60 * 1000;

export type Turn = { role: "user" | "assistant"; content: string };

/**
 * Rows in chronological order → the trailing run with no gap longer than
 * gapMs between neighbours (and from the newest row to `nowMs`).
 */
export function sliceCurrentConversation<T extends { created_at?: string | null }>(
  rows: T[],
  nowMs: number,
  gapMs: number = CONVERSATION_GAP_MS,
): T[] {
  let newer = nowMs;
  let start = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Date.parse(rows[i].created_at ?? "");
    if (!Number.isFinite(t)) break;
    if (newer - t > gapMs) break;
    newer = t;
    start = i;
  }
  return rows.slice(start);
}

// ─── naming detection ─────────────────────────────────────────────

// Everyday feeling words people actually type, beyond the mentor's boxes.
const EXTRA_FEELING_WORDS = [
  "ashamed", "guilty", "jealous", "envious", "lost", "stuck", "empty",
  "overwhelmed", "stressed", "exhausted", "drained", "tired", "unheard",
  "unseen", "ignored", "rejected", "betrayed", "abandoned", "humiliated",
  "helpless", "powerless", "small", "invisible", "unappreciated",
  "unloved", "unwanted", "heartbroken", "grief", "grieving", "panicky",
  "restless", "tense", "resentful", "defeated", "inadequate", "worthless",
  "relieved", "proud", "loved",
];

// Box words that are too common in ordinary sentences to count on their
// own ("an open door", "clear skies"); they count after feel/felt/feeling.
const AMBIGUOUS_FEELING_WORDS = new Set([
  "open", "clear", "strong", "alert", "safe", "secure", "interested",
  "content", "moved", "touched", "alive", "comfortable", "mad", "small",
  "lost", "stuck", "empty", "tired", "glad", "happy", "upset",
]);

const FEELING_WORDS = [
  ...new Set([...BOX1_UNMET_FEELINGS, ...BOX2_MET_FEELINGS, ...EXTRA_FEELING_WORDS]),
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const UNAMBIGUOUS_FEELING_RE = new RegExp(
  `\\b(${
    FEELING_WORDS.filter((w) => !AMBIGUOUS_FEELING_WORDS.has(w)).map(escapeRegex).join("|")
  })\\b`,
  "i",
);
const FRAMED_FEELING_RE = new RegExp(
  `\\b(feel|feeling|felt|feels|i'm|i am|im|so|really|bit|getting|got)\\s+(?:\\w+\\s+){0,2}?(${
    FEELING_WORDS.map(escapeRegex).join("|")
  })\\b`,
  "i",
);

/** The first feeling word the person used, if any. */
export function namedFeeling(text: string): string | null {
  const framed = text.match(FRAMED_FEELING_RE);
  if (framed) return framed[2].toLowerCase();
  const plain = text.match(UNAMBIGUOUS_FEELING_RE);
  return plain ? plain[1].toLowerCase() : null;
}

const NEED_WORDS = [...BOX3_UNIVERSAL_NEEDS, "respected", "appreciated", "seen", "heard", "valued"];
const NEED_FRAME_RE = new RegExp(
  `\\b(need|needed|want|wanted|wish|wished|crave|long for|longing for|miss|missing|deserve)\\s+(?:to\\s+(?:be|feel|have)\\s+)?(?:some\\s+|more\\s+|a\\s+little\\s+)?(${
    NEED_WORDS.map(escapeRegex).join("|")
  })\\b`,
  "i",
);
const PLAIN_NEED_RE = /\b(i (?:just )?(?:need|want|wish)\b|what i (?:really )?(?:need|want)\b)/i;

export function namedNeed(text: string): boolean {
  return NEED_FRAME_RE.test(text) || PLAIN_NEED_RE.test(text);
}

const ARC: Stage[] = [
  "meeting",
  "naming_emotion",
  "naming_need",
  "exploring_origin",
  "surfacing_myth",
  "challenging_belief",
];

/**
 * Promote the stage when the person has already done the naming in their
 * own words. Without this, someone who types "I felt embarrassed" instead
 * of tapping a chip is asked to name their feeling again and again — and
 * never reaches the origin, myth and belief work at all.
 *
 * Once both are named, the deeper stages follow the same turn counts as
 * determineStage. Never moves a stage backwards.
 */
export function refineStageFromText(stage: Stage, userTextsThisConversation: string[]): Stage {
  const at = ARC.indexOf(stage);
  if (at < ARC.indexOf("naming_emotion")) return stage; // meeting / integration / closed
  const feelingNamed =
    at > ARC.indexOf("naming_emotion") || userTextsThisConversation.some((t) => namedFeeling(t));
  const needNamed =
    at > ARC.indexOf("naming_need") || userTextsThisConversation.some((t) => namedNeed(t));
  let byText: Stage;
  if (!feelingNamed) byText = "naming_emotion";
  else if (!needNamed) byText = "naming_need";
  else {
    const priorTurns = userTextsThisConversation.length - 1;
    byText = priorTurns < 5 ? "exploring_origin" : priorTurns < 8 ? "surfacing_myth" : "challenging_belief";
  }
  return ARC.indexOf(byText) > at ? byText : stage;
}

const FEELING_OFFER_RE = new RegExp(`\\b(${FEELING_WORDS.map(escapeRegex).join("|")})\\b`, "i");
const NEED_OFFER_RE = new RegExp(`\\b(${BOX3_UNIVERSAL_NEEDS.map(escapeRegex).join("|")})\\b`, "i");

// ─── language cues (the "conscious communicator" side) ───────────

export type LanguageCues = {
  obligation: string[]; // should / have to / must
  absolutes: string[]; // always / never / everyone / nobody
  but: boolean;
  selfJudgment: string[]; // "I'm so stupid", "my fault"
  repeatedWords: string[]; // content words used across several messages
};

const OBLIGATION_RE = /\b(should(?:n't| not)?|must(?:n't)?|have to|has to|had to|supposed to|ought to|need to)\b/gi;
const ABSOLUTE_RE = /\b(always|never|everyone|everybody|no ?one|nobody|everything|nothing|every time)\b/gi;
const BUT_RE = /\bbut\b/i;
const SELF_JUDGMENT_RE =
  /\b(i(?:'m| am) (?:so |such an? |an? |just )?(?:stupid|idiot|useless|worthless|pathetic|failure|loser|disgusting|terrible|horrible|bad person|not good enough|not enough|too much)|my fault|hate myself|i ruin|i mess(?:ed)? (?:everything|it all) up|i can(?:no|')t do anything right)\b/gi;

const STOPWORDS = new Set(
  ("i me my mine we our you your he she they them his her their it its this that these those a an the and or so " +
    "to of in on at for with from about into over just really very is am are was were be been being do does did " +
    "have has had not no but if then than too also can could would should will shall may might must like get got " +
    "what when where who why how there here some any all more much one thing things feel feeling felt know think " +
    "want need said say says going go went even still maybe because yeah yes ok okay well dont don't im i'm it's " +
    "thats that's").split(/\s+/),
);

function uniqueLower(matches: RegExpMatchArray | null): string[] {
  return [...new Set((matches ?? []).map((m) => m.toLowerCase().replace(/\s+/g, " ")))];
}

export function detectLanguageCues(latest: string, earlierUserTexts: string[] = []): LanguageCues {
  const counts = new Map<string, number>();
  for (const text of [...earlierUserTexts, latest]) {
    const seen = new Set(
      text.toLowerCase().match(/[a-z']{4,}/g)?.filter((w) => !STOPWORDS.has(w)) ?? [],
    );
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const repeatedWords = [...counts.entries()]
    .filter(([w, n]) => n >= 3 && latest.toLowerCase().includes(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  return {
    obligation: uniqueLower(latest.match(OBLIGATION_RE)),
    absolutes: uniqueLower(latest.match(ABSOLUTE_RE)),
    but: BUT_RE.test(latest),
    selfJudgment: uniqueLower(latest.match(SELF_JUDGMENT_RE)),
    repeatedWords,
  };
}

// ─── the bot's own recent patterns ────────────────────────────────

export type ReplyPatterns = {
  openings: string[]; // first three words of recent replies
  questionStreak: number; // consecutive recent replies ending in "?"
  lastQuestionStem: string | null; // e.g. "what does", "can i ask"
  lastQuotedWords: string[]; // words the last reply mirrored in quotes
};

function firstWords(text: string, n: number): string {
  return text.trim().toLowerCase().replace(/^[^a-z]+/, "").split(/\s+/).slice(0, n).join(" ")
    .replace(/[,.;:!?—–-]+$/, "");
}

export function analyzeReplies(assistantTexts: string[]): ReplyPatterns {
  const recent = assistantTexts.slice(-4);
  let questionStreak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (/\?\s*["'”’)]*\s*$/.test(recent[i])) questionStreak++;
    else break;
  }
  const last = recent[recent.length - 1] ?? "";
  const qSentence = last.split(/(?<=[.!?…])\s+/).reverse().find((s) => s.includes("?"));
  const quoted = [...last.matchAll(/["“']([^"”']{2,40})["”']/g)].map((m) => m[1].toLowerCase());
  return {
    openings: recent.map((t) => firstWords(t, 3)).filter(Boolean),
    questionStreak,
    lastQuestionStem: qSentence ? firstWords(qSentence, 2) : null,
    lastQuotedWords: quoted,
  };
}

// ─── moves ────────────────────────────────────────────────────────

export type MoveId =
  | "mirror_words"
  | "offer_feelings"
  | "offer_needs"
  | "body"
  | "specific_curiosity"
  | "imagine"
  | "hunch"
  | "timeline"
  | "myth_test"
  | "word_cue"
  | "mind_vs_self"
  | "observation"
  | "request"
  | "presence"
  | "shelter";

type Move = { id: MoveId; asks: boolean; how: string };

const MOVES: Record<MoveId, Move> = {
  mirror_words: {
    id: "mirror_words",
    asks: false,
    how: 'Mirror back a few of their exact words in quotes and stay with what those words carry — e.g. "\'Taking way too long\'… those words seem to have landed somewhere tender." A statement is enough; no question needed.',
  },
  offer_feelings: {
    id: "offer_feelings",
    asks: true,
    how: "Give them vocabulary: offer two or three feeling words from Box 1/Box 2 that honestly fit what they described, as a light menu they can pick from or correct — e.g. \"Was it closer to embarrassed, hurt… or something else?\"",
  },
  offer_needs: {
    id: "offer_needs",
    asks: true,
    how: "Now that the feeling has a name, offer two or three needs from Box 3 that might sit underneath it, as a menu — e.g. \"I wonder if what was missing was respect, or maybe to be heard?\"",
  },
  body: {
    id: "body",
    asks: true,
    how: "Bring it into the body: wonder where that feeling sits right now, or what it does (tightens, sinks, burns). Keep it concrete and sensory.",
  },
  specific_curiosity: {
    id: "specific_curiosity",
    asks: true,
    how: "Ask about one concrete detail they mentioned — a person, a moment, an exact sentence someone said. Specific, never abstract; something only someone who really listened would ask.",
  },
  imagine: {
    id: "imagine",
    asks: true,
    how: "Use a small act of imagination — e.g. \"If that feeling could speak, what would it want you to know?\" or \"What would a wise friend who loves you say about this?\"",
  },
  hunch: {
    id: "hunch",
    asks: false,
    how: "Offer a tentative insight, owned as yours and easy to correct — \"I might be wrong, but I wonder if…\" — about the unmet need, or about a part of them working hard to protect them. Let it land; a question is optional.",
  },
  timeline: {
    id: "timeline",
    asks: true,
    how: "Go one layer deeper, building on their LAST answer (the 5-why spirit, never an interrogation): when did this first feel familiar, or what did a younger them need back then?",
  },
  myth_test: {
    id: "myth_test",
    asks: true,
    how: "Gently test the belief behind their words rather than accept it as fact — e.g. \"Would you say that about a friend in the same spot?\", \"Is that always true?\", or \"Who first taught you that rule?\" One small dose; curiosity, not debate.",
  },
  word_cue: {
    id: "word_cue",
    asks: true,
    how: "Notice one of their own words from the list below, lightly and without correcting them — e.g. \"I noticed 'should' slipped in there — whose voice does that sound like?\" or \"'Always' is a big word — is it always?\" Only one word, never a lesson.",
  },
  mind_vs_self: {
    id: "mind_vs_self",
    asks: true,
    how: "Help them tell their two inner voices apart: the mind's voice is loud, urgent and repeats itself; the Self's voice is soft, speaks once and leaves a choice. Wonder which one is speaking right now.",
  },
  observation: {
    id: "observation",
    asks: true,
    how: "Help separate what happened from the story about it (observation vs evaluation) — e.g. \"If a camera had recorded that moment, what would it have seen?\"",
  },
  request: {
    id: "request",
    asks: true,
    how: "With permission woven in, help them shape one small, specific, positively-worded request that would meet the need (SPLACE: specific, positive, actionable, collaborative, with appreciation) — e.g. \"If you could ask them for one small thing, what would it be?\"",
  },
  presence: {
    id: "presence",
    asks: false,
    how: "No question this time. Reflect what you're hearing in fresh, plain words and simply stay with them — warmth, not analysis.",
  },
  shelter: {
    id: "shelter",
    asks: false,
    how: "They are being hard on themselves. Do NOT challenge or probe. Hold both truths at once, in your own words: they are fallible, like every human, AND they are unconditionally held and never alone — a well-wisher is always with them. No question.",
  },
};

const STAGE_MOVES: Partial<Record<Stage, MoveId[]>> = {
  meeting: ["mirror_words", "specific_curiosity", "offer_feelings"],
  naming_emotion: ["offer_feelings", "body", "mirror_words", "imagine"],
  naming_need: ["offer_needs", "hunch", "imagine", "specific_curiosity"],
  exploring_origin: ["timeline", "hunch", "specific_curiosity", "body"],
  surfacing_myth: ["myth_test", "observation", "hunch", "mind_vs_self"],
  challenging_belief: ["myth_test", "mind_vs_self", "request", "observation", "hunch"],
};

// When the bot has asked twice in a row, swap to the non-question move
// that best fits the stage.
const NON_QUESTION_FALLBACK: Partial<Record<Stage, MoveId>> = {
  meeting: "mirror_words",
  naming_emotion: "mirror_words",
  naming_need: "hunch",
  exploring_origin: "hunch",
  surfacing_myth: "hunch",
  challenging_belief: "presence",
};

export type TurnPlan = {
  move: MoveId | null;
  guidance: string; // empty when nothing to add
};

export function planTurn(params: {
  stage: Stage;
  latestUserText: string;
  conversation: Turn[]; // this conversation, oldest first, excluding the latest user message
}): TurnPlan {
  const { stage, latestUserText, conversation } = params;
  if (stage === "integration" || stage === "closed") return { move: null, guidance: "" };

  const userTexts = conversation.filter((t) => t.role === "user").map((t) => t.content);
  const assistantTexts = conversation.filter((t) => t.role === "assistant").map((t) => t.content);
  const cues = detectLanguageCues(latestUserText, userTexts);
  const replies = analyzeReplies(assistantTexts);
  const lastReply = assistantTexts[assistantTexts.length - 1] ?? "";
  const shortAnswers =
    latestUserText.trim().split(/\s+/).length <= 4 &&
    (userTexts.length === 0 || userTexts[userTexts.length - 1].trim().split(/\s+/).length <= 6);

  const candidates = STAGE_MOVES[stage] ?? ["presence"];
  let move: MoveId = candidates[assistantTexts.length % candidates.length];

  const cueWords = [...cues.obligation, ...cues.absolutes, ...(cues.but ? ["but"] : [])];
  const cueAlreadyMirrored = cueWords.some((w) =>
    replies.lastQuotedWords.some((q) => q.includes(w))
  );
  const pastNaming = stage !== "meeting" && stage !== "naming_emotion";

  if (cues.selfJudgment.length > 0) {
    move = "shelter";
  } else if (stage === "naming_emotion" && !FEELING_OFFER_RE.test(lastReply)) {
    // The mentor's core ask: give the vocabulary early, don't let the
    // person only sit with an unnamed feeling.
    move = "offer_feelings";
  } else if (stage === "naming_need" && !NEED_OFFER_RE.test(lastReply)) {
    move = "offer_needs";
  } else if (pastNaming && cueWords.length > 0 && !cueAlreadyMirrored && assistantTexts.length % 2 === 0) {
    move = "word_cue";
  } else if (shortAnswers && (stage === "naming_emotion" || stage === "naming_need")) {
    // Short replies: make answering easy with a menu instead of an open question.
    move = stage === "naming_emotion" ? "offer_feelings" : "offer_needs";
  }

  if (MOVES[move].asks && replies.questionStreak >= 2) {
    move = NON_QUESTION_FALLBACK[stage] ?? "presence";
  }

  const lines = [
    "THIS TURN (private guidance — never mention moves, stages or this note):",
    `Move: ${MOVES[move].how}`,
  ];
  if (move === "word_cue") {
    lines.push(`Their words worth noticing: ${cueWords.map((w) => `"${w}"`).join(", ")}.`);
  }
  if (cues.repeatedWords.length > 0) {
    lines.push(
      `They keep coming back to: ${cues.repeatedWords.map((w) => `"${w}"`).join(", ")} — a repeated theme often points at the feeling underneath.`,
    );
  }
  if (replies.openings.length > 0) {
    lines.push(
      `Your recent replies opened with: ${replies.openings.map((o) => `"${o}…"`).join(", ")}. Open differently this time.`,
    );
  }
  if (replies.questionStreak >= 2) {
    lines.push(
      `Your last ${replies.questionStreak} replies each ended with a question. This reply must not end with a question.`,
    );
  } else if (replies.lastQuestionStem) {
    lines.push(`Don't reuse the question shape "${replies.lastQuestionStem}…".`);
  }
  if (shortAnswers) {
    lines.push("Their answers are short — keep yours light and easy to answer; don't pile on depth.");
  }
  lines.push(
    "Make it specific to THEIR words. Never a generic line like \"How does that make you feel?\", \"That sounds really hard\", \"I hear you\" or \"Thank you for sharing\".",
  );
  return { move, guidance: lines.join("\n") };
}
