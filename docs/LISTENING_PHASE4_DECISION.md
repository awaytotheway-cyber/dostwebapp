# Phase 4, Step 1 — the validation result, and the decision

**Date:** 2026-11-04
**Decision: NO-GO. The mock stays.**
**Data:** 48 clips, one speaker, English / Hindi / Marathi, quiet and noisy,
recorded to `scripts/phase4/CLIP_CHECKLIST.md`. Perfectly balanced:
24 activated, 24 flat, 8 per cell per language. 0 skipped.

---

## The question

Can the acoustic features DOST already measures separate *activated*
speech (tense, animated) from *flat* speech (calm, low), better than
guessing? If yes, Phase 4 could ship real arousal with no model, no
licence question and no language gap.

## The bar, set before the data existed

The shipped arousal heuristic reaching **AUC >= 0.75 with p < 0.05 in
English AND in at least one of Hindi or Marathi**, without collapsing to
chance on the noisy clips.

## What came back

| | shipped arousal AUC | p | verdict |
|---|---|---|---|
| English | **0.69** | **0.231** | fails both thresholds |
| Hindi | 0.84 | 0.020 | passes |
| Marathi | 0.98 | 0.000 | passes |

English was mandatory, and English failed. By the letter of the
criterion this is already a NO-GO.

## Why it is a NO-GO on the substance too, not just the letter

The two passing languages pass **for the wrong reason**, and the data
says so plainly.

Mean values, activated minus flat:

| | loudness gap | pace gap |
|---|---|---|
| English | +0.085 | +4 wpm |
| Hindi | +0.109 | +32 wpm |
| Marathi | +0.153 | +52 wpm |

The effect grows monotonically **in the order the languages were
recorded**. One speaker, one sentence, the same four states. Arousal
does not express itself three times more strongly in Marathi than in
English; what changed was the speaker, who by the third language was
contrasting the states far harder than in the first.

`rms_energy` alone reaches **AUC 1.00 in Marathi** — perfect separation
on loudness. The recording instructions name this outcome in advance as
"a warning, not a win". It means the activated clips were simply
recorded louder, which tracks mic distance and delivery as much as
feeling, and will not survive overheard speech.

English — recorded first, least rehearsed, closest to how someone
actually sounds — is the trustworthy estimate here. It says 0.69 with
p = 0.231: indistinguishable from chance.

## The one novel finding, and why it does not rescue the result

`pitch_variability` separates strongly and **inverted** (AUC 0.12,
p < 0.001 overall; consistent at 0.14 / 0.11 / 0.02 across the three
languages): activated speech shows *less* pitch variation, not more.

It does not survive scrutiny:

- **corr(rms_energy, pitch_variability) = -0.49.** It is substantially a
  restatement of loudness, which is the suspect variable. Quiet, breathy
  speech gives the pitch tracker a harder time, so its estimates wobble
  more — higher apparent variability from measurement noise, not feeling.
- **Leave-one-out accuracy is 48%, against a 50% baseline.** A feature
  genuinely worth AUC 0.88 (inverted) should classify well. The ranks
  separate but no single threshold generalises.
- Nine features were tested, so some low p-value was expected by chance.

## What this means

Had we recorded only Marathi, every number would have passed handsomely
and we would have shipped a feature that measures **how theatrically
someone speaks, not how they feel** — and then quietly mis-read every
real listening session, where nobody is performing at all.

That is precisely the failure the spike existed to prevent, and it cost
one hour instead of several weeks.

## Consequences

- `acousticInference.ts` keeps returning `inference_source: 'mock'`.
- `avg_arousal` / `avg_valence` stay quarantined everywhere: chat, the
  nightly synthesis, and the Journey screen, which continues to tell the
  person plainly that their tone is not read.
- Phase 4 does not proceed to integration. Steps 2-8 stay unbuilt.
- Nothing is removed. The harness, the clips and this record stay.

## If this is revisited

The clips are kept as seed data. Two routes, in order of promise:

1. **A trained model on a clean backbone.** The licensing review found
   every off-the-shelf SER model blocked or ambiguous, because the
   emotion-labelled datasets are research-only. A classifier trained on
   our own data over an MIT-licensed backbone (Whisper, wav2vec2 — both
   licences verified from source) avoids that, but needs far more than
   one speaker.
2. **A better-controlled repeat of this spike**, with the languages
   recorded in randomised order and interleaved states, so familiarity
   cannot masquerade as signal. Worth doing only if route 1 is not taken.

Either way the finding stands: **loudness and pace, measured from one
speaker who knows which state they are performing, are not a usable
read on arousal.**
