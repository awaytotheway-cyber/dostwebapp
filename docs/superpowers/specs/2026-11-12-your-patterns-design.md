# Your Patterns, and where Settings lives — design

Agreed in conversation on 2026-11-12, section by section.

## Goal

1. Settings, Profile, Privacy Policy and Terms are easy to find. Settings
   was reachable only from a gear inside the chat header; the privacy
   notice could not be reopened; there were no Terms at all.
2. The person can look back day by day at how they were, written from
   their own conversations, in a few gentle lines.

## Decisions

| Question | Decision |
|---|---|
| Name of the Journey screen | **Your Patterns** (internal route stays `YourJourney`) |
| What a day's summary is written from | The person's own typed messages that day, plus that day's emotion labels. Never DOST's replies, never listening data |
| How a day's state is shown | Feeling chips + a light / mixed / heavy tone marker + 2–4 sentences. No scores, no clinical levels |
| Where Settings, Privacy, Terms go | Profile is the hub: rows for Settings, Privacy Policy, Terms. The chat header loses its gear |
| Privacy Policy and Terms content | Drafted from what the app actually does, banner "Draft — awaiting legal review", English only until reviewed |
| Moving between days | A strip of the last 30 days, tone dots, swipe or tap to change day with a short slide + cross-fade |
| When summaries are produced | On demand when a day is opened, saved per day, rewritten when that day's messages change |

## 1. Navigation and legal screens

- Profile gains an "App" group before "Privacy & account": Settings ›,
  Privacy Policy ›, Terms & Conditions ›.
- The ⚙ leaves the chat header.
- One `LegalDocumentScreen` renders both documents from `lib/legal/`.
  Contact details and anything else only the owner knows are marked
  placeholders, not invented.

## 2. The Your Patterns screen

- New day view at the top; every existing section stays below it.
- Day strip: last 30 days, today on the right. Tone-coloured dot for a
  summarised day, a plain dot for a day with chats not yet summarised,
  a faint empty dot for a day without chats. Opens on the most recent
  day with chats.
- Day card: date, 2–3 feeling chips, tone marker, summary, provenance
  line ("Written from your messages that day" / "So far today").
- Transitions: ~220 ms slide + cross-fade on tap or swipe; instant when
  Reduce Motion is on. React Native `Animated` and `PanResponder`, no new
  dependency.
- States: no chats that day; too little to summarise; loading; error
  with Try again; daily cap reached; offline; support line when the
  safety flag is set.
- Built from existing tokens only: `theme`, the weather earth tones,
  `GentlePressable`, the screen's card shape.

## 3. Producing a day's summary

- Table `daily_summaries`: one row per user, local day and language.
  Tone, feelings, summary text, safety flag, and a fingerprint of the
  source messages (count + latest timestamp). Readable by its owner;
  written only by the function.
- Function `generate-day-summary`, given a local date and IANA time
  zone: load the user's own messages for that day → `empty` with none →
  `sparse` when too little to go on (no model call) → saved row when
  the fingerprint matches → otherwise call the model, validate, save,
  return.
- Feeling chips: top labels from `message_emotions` with confidence
  ≥ 0.5 and not ambiguous — the same rule as listening.
- Writing rules: second person, warm, in the app language, reflect not
  diagnose, no clinical terms, no advice lists, no names or numbers,
  nothing that was not said.
- Safety: signs of self-harm, suicide or harm to others set a flag; the
  summary stays gentle and does not restate details, and the card shows
  Tele-MANAS 14416 (India) or the local emergency number. Verify the
  number in legal review.
- Privacy: summaries are in data export, removed by "delete all
  conversations" and by account deletion. A per-user daily generation
  cap bounds cost.

## 4. Errors, testing, rollout

- An unusable model answer is rejected and never saved; the card offers
  Try again. The rest of the screen keeps working.
- Tests first for the pure logic (local day bounds, fingerprint, sparse
  rule, chip selection, output validation) and for the copy in all 8
  languages; type-check app and function; web build + boot; screenshots
  of Profile, a legal screen and the day view from a fixture harness.
- Rollout: table → function → app build. The owner is asked before the
  table and function touch the live project.

## Out of scope, noted

- Chat itself has no crisis handling.
- Data export omits several existing tables (chat emotion labels,
  journey insights, listening data).
- Voice notes try to upload their recording to a private bucket (none
  stored yet in production: the uploads fail), while the iOS microphone
  permission text says "DOST never saves the audio". One of the two has
  to change; the draft privacy policy describes the code as it is.
- The web bundle throws at start-up without `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`; builds must have them set.

## Verified

- 159 Deno tests across 7 suites; `tsc` clean for the app; `deno check`
  clean for the new and touched functions.
- The real components, rendered with fixture data in a throwaway harness
  and driven in Chromium: opens on the latest day with chats; tapping a
  day animates (mid-transition opacity ~0.5, 12 px slide) and settles;
  Reduce Motion switches instantly; touch swipes move one day each way,
  stop at today, and leave vertical scrolling alone; every card state;
  Hindi; both legal screens with the draft banner; Profile's three rows
  navigate to Settings, Privacy Policy and Terms; with no reachable data
  the day view says it couldn't load instead of claiming no chats.
- Not verified: anything against the live project (the table and the
  function are not deployed), the AI-written summaries themselves, and
  the feel of the swipe on a physical phone.
