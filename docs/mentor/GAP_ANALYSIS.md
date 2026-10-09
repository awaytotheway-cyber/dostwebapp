# DOST — Gap Analysis against the Mentor's Instructions

Source of truth: the six files in `docs/mentor/`.
Snapshot taken against commit `7dbefca` on 2026-10-09.

This document is a map between (a) what the mentor's docs call for and (b) what
the repo currently implements. Each gap has a severity and a suggested next
step so follow-up prompts can be scoped tightly.

---

## 1. What is already built, and roughly aligned

These are the parts of the mentor's spec where the current code is in the
right shape — details may still need to be adjusted, but the surface exists.

| Mentor's call-out | Where it lives in the repo | Alignment |
| --- | --- | --- |
| 1–2 sentence replies, varied openings, no therapy voice, no fixes, strict prohibitions on code / tutorials / facts, warm closings | [lib/dost/systemPrompt.ts](lib/dost/systemPrompt.ts), [supabase/functions/\_shared/systemPrompt.ts](supabase/functions/_shared/systemPrompt.ts) | ~90% of DOST INSTRUCTIONS captured verbatim or near-verbatim |
| Unravelling arc (meeting → naming emotion → naming need → origin → myth → challenging belief → integration → closed) | [supabase/functions/\_shared/conversationStage.ts](supabase/functions/_shared/conversationStage.ts), [lib/emotionalStates.ts](lib/emotionalStates.ts) | Stage machine present; still driven by turn count rather than true readiness signals |
| Suggestion chips: feelings first, then underlying needs | [lib/dost/suggestionChips.ts](lib/dost/suggestionChips.ts), [app/SuggestionChips.tsx](app/SuggestionChips.tsx) | Flow is right. Vocabulary is partial (see §3 KB gap). |
| Few-shot example conversations | [supabase/functions/\_shared/sampleConversations.ts](supabase/functions/_shared/sampleConversations.ts) | 3 scenes, aligned with "name emotion → surface belief → origin" |
| Voice capture + speaker gate so only the user is recorded | [plugins/hearing-service/kotlin/](plugins/hearing-service/kotlin/), [lib/hearing/](lib/hearing/) | Phase 1 + 2 done. Still mock emotion inference (acoustic). |
| Daily reflection with two things to notice tomorrow + morning nudge | [app/ReflectionScreen.tsx](app/ReflectionScreen.tsx), [lib/intentions.ts](lib/intentions.ts), [lib/notifications.ts](lib/notifications.ts) | Done at the "note two things" level; see §4 gap on the evening conversation |
| Personality onboarding | [app/onboarding/](app/onboarding/) — Welcome, Name, Intention, Birth, BirthPlace, Dosha, Enneagram, Numerology, TCM, MBTI, Rhythm, Hobbies, SocialEnergy, Confirm | Covers 6 of the 7 "core" assessments the mentor listed; see §5 |
| Knowledge-base plumbing (pgvector, HNSW, OpenAI 1536-dim embeddings, RAG match in chat) | [supabase/migrations/003\_kb\_embeddings\_openai\_1536.sql](supabase/migrations/003_kb_embeddings_openai_1536.sql), [supabase/functions/embed-modules/](supabase/functions/embed-modules/), [supabase/functions/chat/](supabase/functions/chat/) | **Infra ready. No module content loaded.** This is the biggest hidden gap. |
| Journey consolidation at night | [supabase/functions/generate-journey-insight/](supabase/functions/generate-journey-insight/), [lib/journey.ts](lib/journey.ts) | Nightly summary exists, not yet surfaced as a sit-down evening conversation |
| Multi-language | [lib/i18n/](lib/i18n/) — en, hi, mr, es, de, ru, zh, ja | Not called for by the mentor; harmless to keep |
| Voice notes (manual) | [app/VoiceNoteRecordScreen.tsx](app/VoiceNoteRecordScreen.tsx), [lib/transcribeVoiceNote.ts](lib/transcribeVoiceNote.ts) | Separate from the listening pipeline — a text-first journal |
| Home hub, Settings, Profile, Past Reflections, Your Journey | [app/HomeScreen.tsx](app/HomeScreen.tsx), etc. | Shell is in place |

---

## 2. Core chat behavior — what the mentor asks for that is NOT yet in the bot

Severity scale: **P0** = contradicts the mentor's spirit without it, **P1** =
clearly promised in the docs but can go in a next sprint, **P2** = useful
later.

### 2.1 The Three Chairs role-play — **P0**
**Mentor source:** "Additional instructions for the BOT", with the explicit
rename:
- Child Chair → **Pained Persona**
- Adolescent Chair → **Shielding Manager** / Protective Manager
- Adult Chair → **True Individuated Self**

**Current state:** The system prompt mentions "shielding / protective patterns"
as a *reflection* the bot can make, but calls that language "internal
taxonomy, not user-facing". The actual exercise — asking "which chair am I
in right now?", acknowledging, validating, shifting to the Adult chair,
responding from there — is **not implemented** anywhere in the app. No UI, no
prompt step, no stage machine for it.

**Suggested step:** add a short roleplay surface (a chip or an entry in the
chat that walks the five steps) + a prompt addendum that teaches the bot to
*invite* the exercise when it recognises triggered Pained-Persona or
Shielding-Manager behaviour. Give the surface a non-therapy label consistent
with the mentor's "no `exercise` / `practice` labels" rule.

### 2.2 "Should / should not / but" vocabulary coaching — **P1**
**Mentor source:** "Additional instructions" §Practice Tips §1 — "Remove the
words: Should, Should not and But from your vocabulary. These words connote
Shame."

**Current state:** No awareness in the bot or in any UI. The bot will happily
use "should" itself; it never flags when the user does.

**Suggested step:** add a lint-style side channel in the chat edge function
that counts should/shouldn't/but in the user's own words, and lets the bot
*gently* mirror the pattern (not on every occurrence — maybe when the count
crosses a threshold, in the mentor's tone).

### 2.3 "Mind's voice vs Self voice" distinction — **P1**
**Mentor source:** "Additional instructions" §Practice Tips §2 —
- Mind's voice: Loud, persistent, urgent
- Self voice: Soft, single instance, non-urgent

**Current state:** Not surfaced to the user; the bot doesn't help the user
tell the two apart.

**Suggested step:** one gentle reflective frame the bot can offer when the
user describes something "pushing" or "loud" inside — plus wording for
either/or in the system prompt. No separate UI needed.

### 2.4 NVC: Observation vs Evaluation and SPLACE requests — **P1**
**Mentor source:** "Additional instructions" §Step 2 (Observation vs
Evaluation examples), §Step 5 (SPLACE: **S**pecific, **P**ositive,
**A**ctionable, **C**ollaborative, **E**xpression of gratitude).

**Current state:** Not implemented. The bot never asks the user to re-phrase
a complaint as an observation, nor to turn it into a concrete request.

**Suggested step:** two optional late-stage prompts the bot can offer *with
permission* when the user has named the emotion + the unmet need. "Would it
help to try saying what you observed without the judgement wrapping around
it?" / "Would it help to turn that into a small, specific ask?"

### 2.5 Myth-vs-Truth belief examination with real 5-whys — **P1**
**Mentor source:** "Additional instructions" (unravel myths → challenge
perceived reality → embrace the pained persona), "Conscious Connection App"
step 9 (the 5-why challenge, "but not limited to 5"), and the Three Chairs
emphasis on past wounds and unmet needs.

**Current state:** `surfacing_myth` and `challenging_belief` stages exist but
advance by turn count — not by whether the belief has actually been named,
reality-tested on "does this apply to others / why would others have to
conform", and reconciled. There is no explicit 5-why loop and no exit
criterion.

**Suggested step:** either rework the stage machine to track *what belief
was named* and *which "why" layer we are at*, or add a lightweight sub-stage
with "name the belief → is it always true → does it apply to others → why
specifically to you → what did it protect?". Keep the mentor's hard rule: if
the user shows shame-spiral, stop and return to presence.

### 2.6 Seven A's of Healing — **P1**
**Mentor source:** "CC — Final with ADHD as index disease …":
Awareness, Acknowledgment, Acceptance, Authentic Communication, Alignment,
Attachment, Allowing.

**Current state:** No visible mapping anywhere — the Journey consolidation
could already be colored by this but isn't.

**Suggested step:** tag journey insights with which A they belong to; give
the user a quiet "seven A's map" surface in Your Journey (not therapy-named,
no stars, just a soft indicator of where their reflections have been
clustering).

### 2.7 Attunement-Deficit framing & reattachment language — **P2**
**Mentor source:** the whole "CC — Final with ADHD" paper, in particular
"Reattachment Language Practice" ("I see you're upset and I'm here", "Even
when you're angry, I'm not going anywhere").

**Current state:** The bot writes in roughly this tone already, but there's
no explicit teaching of the practice to the user, and nothing in the system
prompt names "attunement" as the frame.

**Suggested step:** one addendum to the system prompt that specifies the
reattachment voice as the default register; optionally a short "the Lord's
compassion / Paramatma as unconditional shelter" reminder in Your Journey.

### 2.8 Guru / Sādhu / Śāstra protective frame — **P2**
**Mentor source:** "CC — Final with ADHD" §Protective Framework.

**Current state:** Nothing. The app has no notion of mentors / sādhu
community / scriptural reference to triangulate the user's choices against.

**Suggested step:** out of first-build scope — flag for later as a "mentor
link / community" feature.

### 2.9 "Mean what you say, say what you mean" (integrity) — **P2**
**Mentor source:** "Additional instructions" §Practice Tips §3.

**Current state:** Not implemented.

**Suggested step:** a short reflection prompt the bot may offer when the
user describes a situation where they said yes but meant no.

---

## 3. Knowledge base — the biggest hidden gap

### 3.1 The 45 modules — **P0**
**Mentor source:** Meeting synthesis §4.2 and §7.1 — "roughly 45 chapters /
48 module versions"; the mentor explicitly flagged this as one of the two
things that matter for the first build (the brain of the bot).

**Current state:** `kb_modules` table exists. `embed-modules` edge function
can embed anything we put into it. **Zero module content is loaded.** The
chat function tries to pull RAG context, finds nothing, and the LLM falls
back on its own knowledge — exactly the drift the mentor warned about.

**Suggested step:** this is a content-ingestion task. Once the mentor sends
the module files + the book manuscript, we need (a) a safe import script
that preserves the mood and emotion (per Meeting §4.5 — not an AI summary),
(b) a chunking strategy that keeps paragraphs together, (c) re-run
embed-modules, (d) wire the chat function to **require** at least one match
before answering on anything beyond pure presence.

### 3.2 "Tame the Mind — Name your Feelings" vocabulary — **P1**
**Mentor source:** "Additional instructions" §Boxes 1, 2, 3 — the exact lists
of feelings-when-unmet, feelings-when-fulfilled, and universal needs.

**Current state:** The app ships 42 emotions and 27 needs in i18n. They
*overlap* with the mentor's boxes but are not the mentor's lists. For
example, the mentor's Box 1 has "Apathetic / Bitter / Horrified / Reluctant"
and we don't; the mentor's Box 3 has "Honouring the Sacred / Mourning /
Mutuality / Reciprocity / To be heard" and we only have a partial subset.

**Suggested step:** reconcile the taxonomy with the mentor's exact lists.
The bot's "offer a few options" turn should pull from those boxes verbatim.
Keep translations for en / hi / mr in the mentor's three target languages.

### 3.3 The first two modules on identity + fallibility + source — **P0**
**Mentor source:** "Additional instructions" explicitly: "This is thoroughly
described in the first 2 modules of the knowledge base. The Bot should be
able to use this knowledge and convey the user with conviction."

**Current state:** Not loaded.

**Suggested step:** when the mentor sends the modules, ingest these two
first and wire the system prompt to lean on them as the deterrent against
shame-spiral (the user is fallible AND unconditionally held — both at once).

### 3.4 Synthetic training conversations (100k → 200k → 500k) — **P2**
**Mentor source:** Meeting §4.3, §7.1.

**Current state:** Three example scenes in `sampleConversations.ts`. No
synthetic-data pipeline, no eval set, no fine-tune hook.

**Suggested step:** separate workstream — a generator that composes
emotion-state × need × module-chunk triples into realistic dialogues, scored
by a judge agent for adherence to the DOST voice. Not required for the first
build but will be required before launch.

---

## 4. The evening reflection loop — partially built

### 4.1 "How did your day go?" conversation — **P0**
**Mentor source:** Meeting §6.2 — "In the evening — driving home, end of
work — the user asks how the day went. The bot summarises, and a 10–15
minute reflective conversation follows."

**Current state:** We have (a) a nightly journey-insight generator and (b) a
morning noticings nudge. We do **not** have the evening sit-down where the
user is handed a brief summary of what they actually said during the day
and is invited into a 10–15 minute conversation about it.

**Suggested step:** a new "Evening check-in" surface on Home, available
after a certain hour, that opens a chat seeded with (a) the day's
transcribed listening segments, (b) the extracted emotions and needs, (c) a
short prompt that invites the conversation per DOST voice. Reuse the chat
infra and the stage machine; new seed message is enough.

### 4.2 Replay of the user's own words — **P0**
**Mentor source:** Meeting §5.1 (sonic neuroplasticity), §6.2; "Additional
instructions" ("the Bot will be recording the voice of the user and relay
it to the user when the user wants to reflect").

**Current state:** The hearing pipeline currently transcribes and discards
audio to keep nothing on disk (Phase 1 privacy rule). This means the user
can never *hear themselves* back — breaking the sonic-neuroplasticity
mechanism outright.

**Suggested step:** this needs a design decision, since it conflicts with
the current "no audio on disk" posture. Options:
1. Keep encrypted short clips of the user's own matched segments for
   24–48 h, auto-purged, with explicit per-session consent.
2. Keep only the already-transcribed excerpts and have the bot *re-read*
   them in the user's voice via on-device TTS trained on enrollment.
3. Keep opt-in long-form voice-notes separately (already supported) and
   lean on those for the evening replay.
   Mentor sign-off needed on which path. **Flag for the next weekly call.**

### 4.3 Real emotion inference from voice (tone / pitch / volume / quality) — **P1**
**Mentor source:** "Conscious Connection App" step 4 — "Analyze recordings
for tone, pitch, volume, and quality to determine mood."

**Current state:** [lib/hearing/acousticFeatures.ts](lib/hearing/acousticFeatures.ts)
measures the features. [lib/hearing/acousticInference.ts](lib/hearing/acousticInference.ts)
is still a quarantined mock. Emotion inference from the user's voice does
not reach the chat today.

**Suggested step:** either integrate a small on-device model, or route
features into the emotion-extraction LLM call. Needs scoping.

---

## 5. Onboarding — the three missing pieces the mentor named

| Mentor-named assessment | In the app? | Note |
| --- | --- | --- |
| Date and time of birth → **Vedic astrology / birth chart** | Birth date & time collected ([BirthScreen.tsx](app/onboarding/BirthScreen.tsx)) but **no chart derivation** | **P1** — needs an ephemeris lib or an API |
| Dosha for body **and** mind | ✓ ([DoshaScreen.tsx](app/onboarding/DoshaScreen.tsx)) |  |
| Enneagram | ✓ ([EnneagramScreen.tsx](app/onboarding/EnneagramScreen.tsx)) |  |
| MBTI | ✓ ([MBTIScreen.tsx](app/onboarding/MBTIScreen.tsx)) |  |
| Numerology (life path) | ✓ ([NumerologyScreen.tsx](app/onboarding/NumerologyScreen.tsx), [lib/personality/numerology.ts](lib/personality/numerology.ts)) |  |
| Chinese medicine (5 elements) | ✓ ([TCMScreen.tsx](app/onboarding/TCMScreen.tsx)) |  |
| **Varna-type disposition** (Brahmana / Kshatriya / Vaishya / Shudra) | ✗ | **P1** — short questionnaire, not implemented |
| **Dosha radar visualisation** (Meeting §5.4) | ✗ — single-value Dosha stored, no radar | **P2** — polish on top of what's collected |
| Optional: genomics / HRV / wearable upload / facial photo | ✗ | **P2** — explicitly optional in Meeting §5.3 |

---

## 6. Guardrails that are called for but not enforced

### 6.1 Ring-fencing — **P0**
**Mentor source:** Meeting §4.4 — "Ring-fencing so the bot draws on this
knowledge base rather than ChatGPT, outside intelligence, or its own
invention."

**Current state:** The chat function does a RAG match against `kb_modules`,
but if the match score is below threshold, the LLM still answers from its
own weights. There is no hard refusal and no "I can only reflect from what
my teacher has shared" fallback.

**Suggested step:** add a confidence floor on the RAG match. Below the
floor, keep the bot in pure presence mode (reflect + ask one question) and
*never* let it generate didactic content. The mentor's STRICT PROHIBITIONS
should include this rule explicitly.

### 6.2 Manager / checker agents — **P1**
**Mentor source:** Meeting §4.4 — "Manager agent to verify
instruction-following, plus cross-checks for hallucination."

**Current state:** Single-pass LLM call per message. No verifier, no
cross-model check.

**Suggested step:** after the main reply is generated, run a second cheap
pass with the system prompt + the reply, asking the verifier "does this
reply violate any rule? respond with pass or the broken rule." If broken,
regenerate once.

### 6.3 Cross-model verification — **P2**
**Mentor source:** Meeting §9.4.

**Current state:** Not wired. We only use one provider.

**Suggested step:** longer-term; the verifier in §6.2 can be a different
model to start with.

---

## 7. Things in the app that are NOT in the mentor's docs

These are candidates to review with the mentor. None of them is clearly
harmful; the question is whether they fit the vision.

| Feature | Where | Keep / Review |
| --- | --- | --- |
| Pre-chat "covering" picker (shame, pride, lust, …) | [lib/emotionalStates.ts](lib/emotionalStates.ts), [app/EmotionPicker.tsx](app/EmotionPicker.tsx) | **Review** — the mentor explicitly wants the bot to *name* the feeling from Box 1/2, with insights rising from the user's side. A pre-selected label may short-circuit that process. Suggest making this strictly optional + hidden-by-default. |
| Confidence scores + ambiguous_rate metrics on `message_emotions` | migrations 010/011/016 | Keep — pure diagnostics, not user-facing |
| 8-locale i18n (es / de / ru / zh / ja beyond en/hi/mr) | [lib/i18n/](lib/i18n/) | Keep — low cost, higher reach |
| Rhythm / Hobbies / SocialEnergy onboarding | [app/onboarding/](app/onboarding/) | **Review** — not explicitly in the mentor's list. Trim if it makes onboarding too long. |
| Vercel web deploy + home-screen widget | [vercel.json](vercel.json), [widgets/](widgets/) | Keep — not harmful, useful for demo |
| Voice notes (manual text journal) | [app/VoiceNoteRecordScreen.tsx](app/VoiceNoteRecordScreen.tsx) | **Review** — may overlap with the sonic-neuroplasticity listening sessions; two voice-capture paths might confuse users. |
| Anonymous auth with Google sign-in disabled | [App.tsx:30](App.tsx:30) | **Review** — the mentor said full sign-up with demographics; today we silently use anonymous auth. |

---

## 8. Suggested order of work (opinion, not a decision)

Doing these in order gets the app closest to the mentor's vision fastest:

1. **Load the 45 modules** into `kb_modules` once the mentor sends them, and
   add the ring-fence (§3.1 + §6.1). Nothing else matters as much.
2. **Three Chairs role-play surface** (§2.1) — this is the mentor's named
   method.
3. **Evening reflection conversation** that summarises the day from what the
   user said (§4.1) — this is the daily loop the mentor keeps describing.
4. **Decide the voice-replay policy** (§4.2) — needs mentor sign-off; the
   whole sonic-neuroplasticity promise hinges on it.
5. **Reconcile the feelings & needs taxonomy with Boxes 1/2/3** (§3.2) —
   small change, big fidelity win.
6. **Myth-vs-Truth 5-why loop with safe exits** (§2.5).
7. **Verifier pass** on every chat reply (§6.2).
8. **Should / but / Mind-voice vs Self-voice awareness** (§2.2, §2.3).
9. **NVC Observation + SPLACE requests** (§2.4).
10. **Varna questionnaire** and **birth-chart derivation** (§5).
11. **Seven A's of Healing** mapped onto Journey (§2.6).
12. **Real acoustic emotion inference** (§4.3).
13. Longer-term: synthetic data pipeline, Guru/Sadhu/Shastra frame,
    verticals, extra devices.

---

## 9. Open questions for the mentor

Flag these on the next weekly call before coding against assumptions:

1. **Voice replay vs. "no audio on disk" posture.** We cannot do
   sonic-neuroplasticity replay without storing *some* clip of the user's
   voice. Which of the three options in §4.2 fits the mentor's intent?
2. **The pre-chat covering picker** (shame / pride / lust …) — mentor's
   call: should the bot *always* reach feelings/needs via Boxes 1/2/3 inside
   the conversation, or can the user shortcut via a chip before chatting?
3. **The 45 modules** — timing and the preferred ingestion method so that
   the "mood and emotion behind them" (Meeting §4.5) is preserved. Prose
   chunks vs. prompt-formatted lesson blocks?
4. **DOST acronym** — Meeting §3 says the meaning needs to be checked with
   the originator.
5. **Ring-fence failure mode** — when the user asks something the KB
   doesn't cover, is it OK for the bot to say "that's not something I can
   speak to from what I know — but I can sit with you"?
