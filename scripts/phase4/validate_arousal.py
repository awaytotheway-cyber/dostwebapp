#!/usr/bin/env python3
"""
Phase 4, Step 1 — the GO/NO-GO measurement.

Asks one question: can the acoustic features the app already measures
tell ACTIVATED speech (tense, animated) from FLAT speech (calm, low) on
real recordings, in English, Hindi and Marathi, quiet and noisy — better
than guessing?

If yes, Phase 4 can ship real arousal with no model, no licence and no
language gap. If no, the mock stays and we have learned that cheaply.

Usage:
    python3 scripts/phase4/validate_arousal.py clips/
    python3 scripts/phase4/validate_arousal.py clips/ --csv out.csv

Clip filenames carry the labels (see README.md):
    <lang>-<state>-<noise>-<n>.<ext>      e.g. en-tense-quiet-3.m4a

WHY THESE METRICS. With ~15 clips per language, accuracy at a
hand-picked threshold will flatter itself. So:

  AUC          threshold-free. 0.5 is guessing, 1.0 is perfect. Cannot
               be inflated by choosing a cut-off after seeing the data.
  p (perm)     how often shuffled labels beat this AUC, over 10k
               shuffles. Small N means a decent-looking AUC can be luck;
               this is the check on that.
  LOO acc      accuracy where each clip's threshold is chosen WITHOUT
               that clip. The honest accuracy number.
  baseline     always predict the commoner class. What we must beat.
"""

from __future__ import annotations

import argparse
import csv
import random
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import (  # noqa: E402
    AcousticFeatures,
    extract_features,
    load_pcm,
    shipped_arousal,
)

AUDIO_EXTENSIONS = {".m4a", ".wav", ".mp3", ".aac", ".ogg", ".opus", ".flac", ".3gp", ".amr"}

# Arousal is the activation axis only. calm and low are both low-arousal
# but differ in how pleasant they feel; tense and animated are both
# high-arousal and likewise differ. Splitting this way tests whether the
# features track activation specifically, rather than just "good vs bad".
ACTIVATED = {"tense", "animated"}
FLAT = {"calm", "low"}
STATE_ALIASES = {
    "anxious": "tense", "stressed": "tense", "tense": "tense",
    "animated": "animated", "excited": "animated", "lively": "animated",
    "calm": "calm", "relaxed": "calm", "peaceful": "calm",
    "low": "low", "flat": "low", "tired": "low", "drained": "low",
}
NOISE_ALIASES = {"quiet": "quiet", "silent": "quiet", "noisy": "noisy", "noise": "noisy"}

# Word counts for the fixed sentences in README.md. The app derives
# speaking rate from the transcript; these clips use a known sentence
# instead, which also holds the words constant so only DELIVERY varies.
# Edit to match if you reword a sentence.
SENTENCE_WORDS = {"en": 12, "hi": 10, "mr": 10}

FEATURES_TO_SCORE = [
    ("arousal (shipped heuristic)", lambda f: shipped_arousal(f)),
    ("rms_energy", lambda f: f.rms_energy),
    ("speaking_rate_wpm", lambda f: f.speaking_rate_wpm),
    ("pitch_mean_hz", lambda f: f.pitch_mean_hz),
    ("pitch_variability", lambda f: f.pitch_variability),
    ("pitch_variability_normalised*", lambda f: f.pitch_variability_normalised),
    ("vocal_stress_index", lambda f: f.vocal_stress_index),
    ("silence_ratio", lambda f: f.silence_ratio),
    ("voiced_fraction*", lambda f: f.voiced_fraction),
]


# ── labels ────────────────────────────────────────────────────────────

def parse_name(path: Path):
    """<lang>-<state>-<noise>-<n>; also accepts _ or . as separators."""
    parts = [p for p in re.split(r"[-_.\s]+", path.stem.lower()) if p]
    lang = state = noise = None
    for p in parts:
        if p in ("en", "eng", "english"):
            lang = "en"
        elif p in ("hi", "hin", "hindi"):
            lang = "hi"
        elif p in ("mr", "mar", "marathi"):
            lang = "mr"
        elif p in STATE_ALIASES:
            state = STATE_ALIASES[p]
        elif p in NOISE_ALIASES:
            noise = NOISE_ALIASES[p]
    return lang, state, noise


# ── metrics ───────────────────────────────────────────────────────────

def auc(scores: list[float], labels: list[int]) -> float | None:
    """Probability a random activated clip scores above a random flat one.
    Ties count as half. Rank-based, so it needs no threshold."""
    pos = [s for s, y in zip(scores, labels) if y == 1]
    neg = [s for s, y in zip(scores, labels) if y == 0]
    if not pos or not neg:
        return None
    wins = sum((1.0 if p > n else 0.5 if p == n else 0.0) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def permutation_p(scores: list[float], labels: list[int], observed: float, rounds: int = 10_000) -> float:
    """Fraction of label shufflings reaching an AUC at least as extreme.
    Guards against reading signal into 15 clips."""
    rng = random.Random(20261103)
    shuffled = list(labels)
    hits = 0
    # Two-sided in spirit: an AUC far BELOW 0.5 is also a real (inverted) signal.
    target = max(observed, 1 - observed)
    for _ in range(rounds):
        rng.shuffle(shuffled)
        a = auc(scores, shuffled)
        if a is not None and max(a, 1 - a) >= target:
            hits += 1
    return hits / rounds


def loo_accuracy(scores: list[float], labels: list[int]) -> float | None:
    """Leave-one-out: each clip is classified by a threshold fitted only
    to the others, so the number is not self-congratulatory."""
    n = len(scores)
    if n < 3 or len(set(labels)) < 2:
        return None
    correct = 0
    for i in range(n):
        rest_s = scores[:i] + scores[i + 1:]
        rest_y = labels[:i] + labels[i + 1:]
        best_t, best_acc = None, -1.0
        for t in sorted(set(rest_s)):
            acc = sum((s >= t) == bool(y) for s, y in zip(rest_s, rest_y)) / len(rest_s)
            if acc > best_acc:
                best_acc, best_t = acc, t
        if best_t is not None and ((scores[i] >= best_t) == bool(labels[i])):
            correct += 1
    return correct / n


def baseline_accuracy(labels: list[int]) -> float:
    if not labels:
        return 0.0
    ones = sum(labels)
    return max(ones, len(labels) - ones) / len(labels)


# ── reporting ─────────────────────────────────────────────────────────

def score_cell(name: str, rows: list[dict]) -> None:
    labels = [r["activated"] for r in rows]
    n_pos, n_neg = sum(labels), len(labels) - sum(labels)
    base = baseline_accuracy(labels)

    print(f"\n  {name}  (n={len(rows)}: {n_pos} activated, {n_neg} flat)")
    if n_pos == 0 or n_neg == 0:
        print("    only one class present — cannot score this cell")
        return
    print(f"    {'feature':<32} {'AUC':>6} {'p(perm)':>9} {'LOO acc':>8} {'baseline':>9}")
    for label, fn in FEATURES_TO_SCORE:
        scores = [fn(r["features"]) for r in rows]
        a = auc(scores, labels)
        if a is None:
            continue
        p = permutation_p(scores, labels, a)
        loo = loo_accuracy(scores, labels)
        flag = ""
        if a >= 0.75 and p < 0.05:
            flag = "  <-- separates"
        elif a <= 0.25 and p < 0.05:
            flag = "  <-- separates, INVERTED"
        print(
            f"    {label:<32} {a:>6.2f} {p:>9.3f} "
            f"{(f'{loo:.0%}' if loo is not None else '   n/a'):>8} {base:>8.0%}{flag}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 4 Step 1 arousal validation")
    ap.add_argument("clips", type=Path, help="directory of labelled clips")
    ap.add_argument("--csv", type=Path, help="write per-clip features here")
    args = ap.parse_args()

    if not args.clips.is_dir():
        print(f"error: {args.clips} is not a directory", file=sys.stderr)
        return 2

    paths = sorted(p for p in args.clips.rglob("*") if p.suffix.lower() in AUDIO_EXTENSIONS)
    if not paths:
        print(f"error: no audio files under {args.clips}", file=sys.stderr)
        return 2

    rows: list[dict] = []
    skipped: list[str] = []

    with tempfile.TemporaryDirectory(prefix="phase4-") as tmp:
        scratch = Path(tmp)
        for path in paths:
            lang, state, noise = parse_name(path)
            if not lang or not state:
                skipped.append(f"{path.name}: need a language and a state in the filename")
                continue
            if noise is None:
                noise = "quiet"
            try:
                pcm, rate = load_pcm(path, scratch)
            except Exception as exc:  # noqa: BLE001
                skipped.append(f"{path.name}: could not decode ({exc})")
                continue
            duration = len(pcm) / rate if rate else 0.0
            if duration < 0.8:
                skipped.append(f"{path.name}: only {duration:.1f}s of audio")
                continue
            feats = extract_features(pcm, rate, SENTENCE_WORDS.get(lang, 10), duration)
            rows.append({
                "file": path.name, "lang": lang, "state": state, "noise": noise,
                "duration_s": round(duration, 2),
                "activated": 1 if state in ACTIVATED else 0,
                "features": feats,
            })

    print("=" * 74)
    print("PHASE 4 STEP 1 — can the features we already have read arousal?")
    print("=" * 74)
    print(f"\nScored {len(rows)} clips; skipped {len(skipped)}.")
    for s in skipped:
        print(f"  skipped  {s}")
    if not rows:
        print("\nNothing to score.")
        return 1

    counts = defaultdict(int)
    for r in rows:
        counts[(r["lang"], r["noise"], r["state"])] += 1
    print("\nClips per cell:")
    for lang in ("en", "hi", "mr"):
        for noise in ("quiet", "noisy"):
            cell = {s: counts[(lang, noise, s)] for s in ("calm", "low", "tense", "animated")}
            if any(cell.values()):
                print(f"  {lang} {noise:<6} " + "  ".join(f"{k}={v}" for k, v in cell.items()))

    print("\n" + "-" * 74)
    print("RESULTS  (* = not in the app today; a candidate change)")
    print("-" * 74)

    score_cell("ALL CLIPS", rows)
    for lang in ("en", "hi", "mr"):
        sub = [r for r in rows if r["lang"] == lang]
        if sub:
            score_cell(f"language: {lang}", sub)
    for noise in ("quiet", "noisy"):
        sub = [r for r in rows if r["noise"] == noise]
        if sub:
            score_cell(f"condition: {noise}", sub)
    for lang in ("en", "hi", "mr"):
        for noise in ("quiet", "noisy"):
            sub = [r for r in rows if r["lang"] == lang and r["noise"] == noise]
            if len(sub) >= 6:
                score_cell(f"{lang} / {noise}", sub)

    print("\n" + "=" * 74)
    print("READING THIS")
    print("=" * 74)
    print("""
AUC 0.5 is guessing. Rough reading: 0.7 is a weak but real signal,
0.8 is solid, 0.9 is strong. p(perm) under 0.05 means it is unlikely
to be luck; above that, treat a high AUC as unproven however good it
looks.

GO needs, at minimum: the shipped arousal heuristic at AUC >= 0.75
with p < 0.05 in English AND at least one of Hindi/Marathi, and not
collapsing to chance in the noisy clips.

Worth looking for as well:
  - A single feature beating the combined heuristic. The heuristic
    only uses loudness and pace; if pitch variability or vocal strain
    scores higher, the heuristic should be reweighted.
  - pitch_variability_normalised* beating pitch_variability. That
    would mean the app's raw-correlation voicing threshold is costing
    real signal and is worth fixing.
  - rms_energy carrying most of the weight. That is a warning, not a
    win: loudness tracks mic distance and phone auto-gain as much as
    activation, so it may not survive everyday use.
""")

    if args.csv:
        with args.csv.open("w", newline="") as fh:
            w = csv.writer(fh)
            first = rows[0]["features"].as_dict()
            w.writerow(["file", "lang", "state", "noise", "activated", "duration_s",
                        "arousal_shipped", *first.keys()])
            for r in rows:
                d = r["features"].as_dict()
                w.writerow([r["file"], r["lang"], r["state"], r["noise"], r["activated"],
                            r["duration_s"], round(shipped_arousal(r["features"]), 4),
                            *(round(v, 6) for v in d.values())])
        print(f"Per-clip features written to {args.csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
