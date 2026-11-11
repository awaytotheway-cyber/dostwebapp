# Listening — Phase 3 status

Phase 3 connects listening sessions to the rest of DOST: a per-session
aggregate on the device, read by the chat function as a private tonal
lens and by the nightly synthesis.

Last verified against the live project (`frlzcwsjiirgwqzwycfy`) on
2026-10-29.

## What is in place

| Piece | Where | State |
|---|---|---|
| `listening_summaries` table | `supabase/migrations/025_…sql` | live |
| Device-side aggregation | `lib/hearing/sessionSummary.ts`, written on stop by `lib/hearing/pipeline.ts` | needs an Android build to ship |
| Chat tonal lens | `supabase/functions/_shared/voiceContext.ts`, loaded by `chat` | deployed |
| Nightly voice block | `supabase/functions/nightly-consolidation/index.ts` | live (version 3) |

Flow: a listening session writes many `voice_signals` rows → on stop the
device folds them into one `listening_summaries` row → `chat` reads the
last 14 days as a private prompt block, and `nightly-consolidation`
reads them per synthesis window.

## The mock quarantine

`acousticInference.ts` fakes acoustic emotion. Only two fields are
affected — `avg_arousal` and `avg_valence` — and `inference_source`
marks their provenance.

Rules every reader follows:

- Rows are **not** dropped when `inference_source` is `mock`. The
  emotion/need counts and the measured acoustics in those rows are real,
  and discarding them would throw away good data over a field nobody
  reads.
- Arousal and valence are read **only** from rows marked `acoustic_v1`
  or `fused_v1`. Until Phase 4 validates a real model that means never,
  so no fabricated number can reach a user, a reply or a prompt.
- A summary is marked with a real source only when **every** contributing
  segment had one. One mock segment taints the average, so the whole
  summary reads `mock`.

## Honesty posture in chat

The tonal lens is a private system-prompt block. It carries its own
rules: never tell the person what was heard, never mention that
listening happened, never treat it as something that happened in this
conversation, and always let their current words outrank it. It
describes recent weeks in aggregate, never a specific moment.

## Repo/production drift — read this before deploying

`listening_summaries`, `user_understanding`, the two consolidation
helper functions and the whole `nightly-consolidation` function were
created directly against the project and had never been committed. The
repo could not rebuild the database, and a deploy from the repo could
have silently removed them.

They are now captured in migration `025` and in
`supabase/functions/nightly-consolidation/index.ts`. Two things follow:

- The migration is idempotent and was written from the live schema. It
  is a record of what already exists, not a change to apply.
- The committed `nightly-consolidation` source adds type annotations the
  deployed bundle lacks, so it passes `deno check`. It is otherwise
  identical. Production still runs version 3; redeploy from the repo
  only alongside a real change.

**Keep schema and function changes in this repo from now on.** Anything
made only in the dashboard can be lost by the next deploy.

## Not done

- **Nothing has exercised this end to end yet.** `listening_summaries`
  is empty, because the device-side writer ships with the next Android
  build. Until then the chat block is empty for everyone, which is why
  deploying it was safe.
- **The nightly synthesis has never produced a row.** Its scheduled run
  on 2026-10-29 at 03:00 failed with `DeepSeek synthesis failed: 401`,
  and the key in the error reads `undefined` — so `DEEPSEEK_API_KEY` is
  not set on Edge Functions. `user_understanding` has no rows at all,
  so this has presumably failed from the start. Set the secret under
  Project Settings → Edge Functions → Secrets; nothing in the code
  needs changing. Until then the voice block in the nightly prompt is
  built and then thrown away with the failed run.
- Listening emotions still do not reach the Journey screen; it reads
  `message_emotions` and `voice_notes` only.
- Acoustic emotion remains mocked — that is Phase 4, which is gated on
  a validation spike.

## Accuracy fixes — 2026-11-10

An end-to-end review against the live project found that what the
listening pipeline showed people was not an accurate read of how they
felt. The only real session (2026-11-08, ~42 s of speech) produced four
segments, each transcribed to about one word, each labelled
"detachment / understanding" at confidence 0.2–0.3 — the classifier's
"unclear" fallback — and that summary was what Journey and chat read.

| Problem | Fix |
|---|---|
| On-device Whisper was given Float32 bytes; whisper.rn reads Int16 PCM, so it heard noise | `lib/hearing/pcm.ts` converts first; Whisper's `[BLANK_AUDIO]`-style tags are stripped |
| Low-confidence labels were counted as feelings | Only labels with `semantic_confidence >= 0.5` count (`isCountable` in `sessionSummary.ts`); acoustics are kept either way |
| No way to say "no feeling here", so ordinary talk was forced into a feeling | New hidden `neutral` label: stored on `voice_signals`, never counted or shown (device, Journey, chat lens) |
| Invented tokens became "detachment" with the model's own confidence | `hearing-extract-emotions/classification.ts`: invented → low-confidence `neutral`; invented need → `null` |
| Consent copy said audio never leaves the phone | Disclosure, settings and permission copy rewritten in all 8 locales, describing Android's notification and the iPhone's microphone indicator; disclosure ack bumped to `v2` so everyone sees it again |
| The notification's Stop left the session open and blocked a new one | Any stop the app didn't ask for (Android's notification Stop, an iOS interruption) now finishes the session; the screen follows the pipeline to the summary |
| A failed speaker-model download silently enrolled the weak MFCC voiceprint, which then dropped the owner's own speech (2026-11-11: similarity 0.36–0.42, all "ambiguous") | The model downloads from GitHub, then an identical Hugging Face copy (`speakerModelSource.ts`); if both fail, enrollment stops and asks the person to retry. MFCC remains only for builds that can't run the neural model |
| Listening tile and recording settings shown where listening can't run | Shown only where the native module exists (Android, and iOS builds that include it — see `LISTENING_IOS.md`) |

**Deploy order matters.** Ship the Android build first, then deploy
`hearing-extract-emotions`. The new client already ignores the old
function's low-confidence fallback, but an old build talking to the new
function would count `neutral` into its summaries. `chat` (for the
`voiceContext` filter) can be redeployed any time.

Still true: acoustic emotion stays mocked (Phase 4 NO-GO), and the
classifier's taxonomy has no positive states — whether to add any is a
product decision.

## Tests

- `supabase/functions/_shared/voiceContext_test.ts` — the prompt block:
  mock arousal never surfaces, real arousal does, mock rows keep their
  real data, labels cannot inject into the prompt.
- `lib/hearing/sessionSummary_test.ts` — the aggregate: counting,
  averaging, null handling, and the pessimistic provenance rule.

Also `lib/hearing/pcm_test.ts` (Whisper's input format, transcript
cleanup), `supabase/functions/hearing-extract-emotions/classification_test.ts`
(neutral and invented-token handling) and
`lib/i18n/listeningDisclosureCopy_test.ts` (the consent copy).

Run them with `deno test supabase/functions/_shared/`,
`deno test supabase/functions/hearing-extract-emotions/`,
`deno test lib/hearing/ lib/journeyListening_test.ts` and
`deno test --allow-import --sloppy-imports lib/i18n/`. The app has no
JavaScript test runner, so these are Deno tests and are excluded from
`tsc` via `tsconfig.json`.
