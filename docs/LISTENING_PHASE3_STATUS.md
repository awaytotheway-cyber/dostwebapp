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
- Listening emotions still do not reach the Journey screen; it reads
  `message_emotions` and `voice_notes` only.
- Acoustic emotion remains mocked — that is Phase 4, which is gated on
  a validation spike.

## Tests

- `supabase/functions/_shared/voiceContext_test.ts` — the prompt block:
  mock arousal never surfaces, real arousal does, mock rows keep their
  real data, labels cannot inject into the prompt.
- `lib/hearing/sessionSummary_test.ts` — the aggregate: counting,
  averaging, null handling, and the pessimistic provenance rule.

Run them with `deno test supabase/functions/_shared/` and
`deno test lib/hearing/`. The app has no JavaScript test runner, so
these are Deno tests and are excluded from `tsc` via `tsconfig.json`.
