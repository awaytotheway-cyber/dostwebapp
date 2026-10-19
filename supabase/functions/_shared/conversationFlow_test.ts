import {
  analyzeReplies,
  detectLanguageCues,
  namedFeeling,
  namedNeed,
  planTurn,
  refineStageFromText,
  sliceCurrentConversation,
  type Turn,
} from "./conversationFlow.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("sliceCurrentConversation: keeps only the trailing run without a long gap", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const rows = [
    { id: 1, created_at: "2026-10-17T09:00:00Z" },
    { id: 2, created_at: "2026-10-17T09:05:00Z" },
    { id: 3, created_at: "2026-10-18T11:30:00Z" },
    { id: 4, created_at: "2026-10-18T11:50:00Z" },
  ];
  const ids = sliceCurrentConversation(rows, now).map((r) => r.id);
  assert(ids.join(",") === "3,4", `expected 3,4 got ${ids}`);
  assert(
    sliceCurrentConversation(rows, now + 4 * 3600_000).length === 0,
    "a long silence since the last row starts a fresh conversation",
  );
});

Deno.test("namedFeeling: picks up typed feelings, ignores incidental words", () => {
  assert(namedFeeling("I think I felt a bit embarrassed") === "embarrassed", "framed feeling");
  assert(namedFeeling("Honestly just frustrated with all of it") === "frustrated", "plain box word");
  assert(namedFeeling("I'm so tired of this") === "tired", "ambiguous word after a frame");
  assert(namedFeeling("The door was open and the sky was clear") === null, "incidental words");
  assert(namedFeeling("My boss said I'm taking too long") === null, "no feeling named");
});

Deno.test("namedNeed: needs said in plain words", () => {
  assert(namedNeed("I just want to be heard for once"), "want to be heard");
  assert(namedNeed("I need some respect at work"), "need respect");
  assert(!namedNeed("We had food at the meeting"), "a Box 3 word in passing is not a need");
});

Deno.test("refineStageFromText: typed naming moves the arc forward", () => {
  assert(
    refineStageFromText("naming_emotion", ["he snapped at me", "I felt really hurt"]) ===
      "naming_need",
    "typed feeling → naming_need",
  );
  assert(
    refineStageFromText("naming_emotion", ["I felt hurt", "I just want to be respected"]) ===
      "exploring_origin",
    "typed feeling and need → exploring_origin",
  );
  assert(
    refineStageFromText("naming_emotion", ["he snapped at me"]) === "naming_emotion",
    "nothing named yet stays",
  );
  assert(
    refineStageFromText("challenging_belief", ["I felt hurt"]) === "challenging_belief",
    "later stages untouched",
  );
});

Deno.test("detectLanguageCues: should / always / but / self-judgment / repetition", () => {
  const cues = detectLanguageCues(
    "I should have known, but I always mess things up at work",
    ["work was awful", "my work never ends"],
  );
  assert(cues.obligation.includes("should"), "should");
  assert(cues.absolutes.includes("always"), "always");
  assert(cues.but, "but");
  assert(cues.repeatedWords.includes("work"), `repeated: ${cues.repeatedWords}`);
  assert(
    detectLanguageCues("it's my fault, I'm so stupid").selfJudgment.length === 2,
    "self-judgment",
  );
});

Deno.test("analyzeReplies: streaks, openings, quoted words", () => {
  const r = analyzeReplies([
    "That sounds heavy. What happened next?",
    "\"Way too long\" — those words stung. What did that bring up?",
  ]);
  assert(r.questionStreak === 2, `streak ${r.questionStreak}`);
  assert(r.openings[0] === "that sounds heavy", `opening ${r.openings[0]}`);
  assert(r.lastQuestionStem === "what did", `stem ${r.lastQuestionStem}`);
  assert(r.lastQuotedWords.includes("way too long"), "quoted words");
});

Deno.test("planTurn: offers vocabulary early in naming_emotion", () => {
  const plan = planTurn({
    stage: "naming_emotion",
    latestUserText: "My boss said I'm taking way too long",
    conversation: [],
  });
  assert(plan.move === "offer_feelings", `move ${plan.move}`);
  assert(plan.guidance.includes("Box 1"), "mentions the naming palette");
});

Deno.test("planTurn: breaks a run of questions", () => {
  const conversation: Turn[] = [
    { role: "user", content: "I felt hurt when he left early" },
    { role: "assistant", content: "Hurt, and maybe a little alone in it? When did that start?" },
    { role: "user", content: "As a kid I think, my dad was never around" },
    { role: "assistant", content: "Never around… what did that younger you need most?" },
  ];
  const plan = planTurn({
    stage: "exploring_origin",
    latestUserText: "Someone to just show up for me",
    conversation,
  });
  assert(plan.move === "hunch" || plan.move === "presence", `move ${plan.move}`);
  assert(plan.guidance.includes("must not end with a question"), "tells the model to stop asking");
});

Deno.test("planTurn: shelter instead of challenge when they turn on themselves", () => {
  const plan = planTurn({
    stage: "challenging_belief",
    latestUserText: "Honestly I'm so useless, it's all my fault",
    conversation: [],
  });
  assert(plan.move === "shelter", `move ${plan.move}`);
});

Deno.test("planTurn: notices 'should' once the feeling is named", () => {
  const plan = planTurn({
    stage: "surfacing_myth",
    latestUserText: "I should be able to handle this by now",
    conversation: [
      { role: "user", content: "I felt anxious all week" },
      { role: "assistant", content: "Anxious all week is a lot to carry." },
      { role: "user", content: "Yeah, I need some calm" },
      { role: "assistant", content: "Calm sounds like it's been missing." },
    ],
  });
  assert(plan.move === "word_cue", `move ${plan.move}`);
  assert(plan.guidance.includes('"should"'), "names the word to notice");
});

Deno.test("planTurn: rotates moves across turns instead of repeating one", () => {
  const moves = new Set<string>();
  const conversation: Turn[] = [];
  for (let i = 0; i < 4; i++) {
    const plan = planTurn({ stage: "exploring_origin", latestUserText: "mm, maybe yes", conversation });
    moves.add(plan.move ?? "none");
    conversation.push({ role: "user", content: "mm, maybe yes" });
    conversation.push({ role: "assistant", content: `Reply number ${i}.` });
  }
  assert(moves.size >= 3, `only ${[...moves]}`);
});

Deno.test("planTurn: silent on integration and closing", () => {
  assert(
    planTurn({ stage: "integration", latestUserText: "okay", conversation: [] }).guidance === "",
    "integration",
  );
  assert(
    planTurn({ stage: "closed", latestUserText: "thanks, bye", conversation: [] }).guidance === "",
    "closed",
  );
});

Deno.test("refineStageFromText: typed naming still reaches the myth and belief work", () => {
  const texts = [
    "my sister forgot my birthday",
    "I felt hurt",
    "I just want to matter to her",
    "it's been like this since we were kids",
    "mum always took her side",
    "I should be over it",
    "the loud voice, definitely",
  ];
  assert(
    refineStageFromText("naming_emotion", texts) === "surfacing_myth",
    `got ${refineStageFromText("naming_emotion", texts)}`,
  );
  assert(
    refineStageFromText("challenging_belief", texts.slice(0, 3)) === "challenging_belief",
    "never moves backwards",
  );
});

Deno.test("planTurn: offers a needs menu right after the feeling is named", () => {
  const plan = planTurn({
    stage: "naming_need",
    latestUserText: "I guess I felt hurt. And kind of invisible.",
    conversation: [
      { role: "user", content: "My sister didn't call me on my birthday." },
      { role: "assistant", content: "Was it closer to hurt, disappointed, or lonely?" },
    ],
  });
  assert(plan.move === "offer_needs", `move ${plan.move}`);
});
