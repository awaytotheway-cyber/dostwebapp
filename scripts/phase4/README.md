# Phase 4, Step 1 — recording and measuring the clips

This decides whether Phase 4 goes ahead, and it needs about an hour of
your time with a phone.

**The question.** Can the acoustic features DOST already measures tell
*activated* speech (tense, animated) from *flat* speech (calm, low) — on
your real voice, in English, Hindi and Marathi, quiet and noisy, better
than guessing?

If yes, Phase 4 can ship real arousal with **no model, no licence
question and no language gap**, because these are measurements rather
than machine learning. If no, the mock stays and we have learned that
for the price of an hour instead of weeks.

---

## What to say

Say **the same sentence every time**, changing only *how* you say it.
That is the whole point: if the words changed too, we could not tell
whether the measurements were picking up your delivery or your
vocabulary.

| | Sentence |
|---|---|
| English | I have to go to the office tomorrow and finish the report. |
| Hindi | मुझे कल ऑफिस जाना है और रिपोर्ट पूरी करनी है। |
| Marathi | मला उद्या ऑफिसला जायचं आहे आणि रिपोर्ट पूर्ण करायचा आहे. |

Deliberately dull sentences — nothing in the words themselves suggests
any feeling.

If you reword any of them, count the words and update `SENTENCE_WORDS`
at the top of `validate_arousal.py`, because speaking rate is worked out
from the word count.

## The four states

Two are activated, two are flat. Within each pair the energy is similar
but the feeling is opposite — that is intentional, so we find out whether
the measurements track *activation* rather than just "good vs bad".

| State | Say it as if… | |
|---|---|---|
| `animated` | you are energised, keen, talking fast | activated |
| `tense` | you are on edge, pressured, wound up | activated |
| `calm` | you are settled, unhurried, at ease | flat |
| `low` | you are drained, heavy, flat | flat |

**Mean it rather than perform it.** This matters more than it sounds.
The reason lab-trained emotion models fall apart in real life is that
they learned from actors. If you ham it up, we will measure your acting
and get an answer that looks better than the truth. Aim for how you
would actually sound on a tired Tuesday, not a stage version of it.

If a take comes out not feeling like the state you meant, delete it or
relabel it as what it actually was. An honestly mislabelled clip is
worse than no clip.

## How many

Per language, record each of the 4 states **twice in a quiet room** and
**twice with background noise** (TV, traffic, a fan — ordinary life, at a
level where you would still be understood).

That is 16 clips per language, **48 in total**. Three takes each (72
total) would give a firmer answer if you have the patience; two is
enough to get a usable result.

## Keeping it fair

Because some of these features are sensitive to recording conditions,
hold these steady or the result will measure your microphone instead of
your mood:

- **Same phone, same recorder app, all 48 clips.**
- **Same distance** — about 20 cm, and hold it the same way each time.
- **Turn off** noise suppression, voice enhancement and auto-gain if your
  recorder has them. Automatic volume levelling is the worst offender: it
  flattens exactly the loudness differences we are trying to measure.
- **Record quiet and noisy versions in the same session**, so your voice
  and the setup have not drifted between them.
- Leave a moment of silence at the start and end; don't clip the first
  word.

## Naming the files

The filename carries the labels:

```
<language>-<state>-<noise>-<number>.<ext>
```

Language is `en`, `hi` or `mr`. Noise is `quiet` or `noisy`. Any audio
format off a phone is fine — `.m4a`, `.wav`, `.mp3`, `.opus`, `.3gp`.

```
en-animated-quiet-1.m4a
en-animated-quiet-2.m4a
en-tense-quiet-1.m4a
en-calm-quiet-1.m4a
en-low-quiet-1.m4a
en-animated-noisy-1.m4a
...
hi-calm-quiet-1.m4a
mr-low-noisy-2.m4a
```

Underscores and spaces work too, and the order of the parts does not
matter, so `hi_calm_quiet_1.m4a` is read the same way. Any clip whose
language or state cannot be read is skipped and listed, so nothing is
silently miscounted.

## Running it

Put every clip in one folder and run:

```bash
python3 scripts/phase4/validate_arousal.py path/to/clips/
python3 scripts/phase4/validate_arousal.py path/to/clips/ --csv features.csv
```

Needs Python 3, `numpy` and `ffmpeg`. The permutation tests take a couple
of minutes for 48 clips.

## Reading the result

`AUC` is the headline. It is the chance that a randomly chosen activated
clip scores above a randomly chosen flat one. **0.5 is guessing**, 0.7 is
a weak but real signal, 0.8 is solid, 0.9 is strong. AUC is used rather
than plain accuracy because accuracy depends on where you put the
cut-off, and picking that cut-off after seeing the answers flatters the
result.

`p (perm)` is the reality check. With 16 clips per language a good AUC
can easily be luck, so the labels are shuffled 10,000 times to see how
often chance does as well. **Under 0.05** means it probably is not luck.

`LOO acc` is accuracy where each clip is judged by a threshold fitted
without it — the honest accuracy. `baseline` is what you get by always
guessing the commoner class, and is the bar to beat.

### What counts as GO

The shipped arousal heuristic reaching **AUC ≥ 0.75 with p < 0.05 in
English and in at least one of Hindi or Marathi**, and not collapsing to
chance on the noisy clips.

### Also worth looking for

- **A single feature beating the combined heuristic.** The shipped
  heuristic only uses loudness and pace. If pitch variability or vocal
  strain scores higher on its own, the heuristic is weighted wrongly and
  should be changed.
- **`pitch_variability` beating `pitch_variability_pre_fix*`.** The
  starred feature is not in the app. It reproduces a bug the app had
  until recently: its voicing test compared raw correlation against a
  threshold, which made it a loudness gate rather than a periodicity
  test. On synthetic clips it returned 0 Hz for every quiet clip, found
  pitch in every loud one, and assigned a pitch to loud noise. That is
  now fixed, and the gap between these two features is what the fix
  bought on your real speech. If the starred one scores higher, the fix
  hurt and we should look again.
- **`rms_energy` carrying most of the weight.** That is a warning, not a
  win. Loudness follows how you held the phone as much as how you felt,
  so it may not survive everyday use even if it scores well here.
- **A result that is strong in English and chance-level in Hindi and
  Marathi.** Then arousal should ship for English only, or not at all —
  not quietly ship everywhere and be wrong for two thirds of your users.

---

## What this cannot tell us

Be clear about the limits before reading too much into a good number:

- These are **deliberate** recordings, not overheard speech. Even said
  honestly, they are more exaggerated than how you sound when you are not
  thinking about it. Expect real listening sessions to score worse.
- **One voice.** A result on your voice says nothing certain about
  anyone else's, and nothing about how it behaves across ages, genders or
  accents.
- **Arousal only.** Valence — whether a feeling is pleasant — is not
  measurable from these features, and nothing here changes that. `calm`
  and `low` are meant to score the same on arousal and do not tell them
  apart.
- A GO result means "worth building", not "accurate". Whatever ships
  stays a low-confidence hint, stays subordinate to the words, and keeps
  its kill switch.

## Afterwards

These clips are the seed dataset if we later want the trained-model
route (a clean MIT-licensed backbone plus our own classifier), so keep
them. Nothing here is wasted by changing route.

This directory is a validation tool, not part of the app. It can be
deleted once Phase 4 is decided either way.
