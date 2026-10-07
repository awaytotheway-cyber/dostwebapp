#!/usr/bin/env python3
"""
H1/H2 desktop check of the clip logic before testing on the phone.

Builds 10-minute recordings with about 2 minutes of real speech (AudioMNIST
digits strung into 6-14 s utterances with natural pauses) placed at random,
runs them through ClipAssemblerSim (the phone's ClipAssembler), and reports:

  saved vs speech      H1: saved should be about speech + padding
  speech kept          share of speech samples inside a saved clip
  mostly-silence clips clips where under half the audio is speech
  first words          how much audio a clip keeps before each utterance (H2)

Scenarios: quiet room, steady fan/AC, a phone call (mic silenced for 30 s),
and household noise (door, typing, chewing) — the last one is saved in this
step because the speech detector arrives in Step 3.

Usage
  python h1_sim.py AUDIOMNIST_DIR NOISE_DIR SIM_JAR OUT_DIR
"""
import glob
import json
import os
import random
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

SR = 16000
TOTAL_S = 600
BURSTS = 12


def load(path):
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x


def trim(x, db=-35.0):
    f = 160
    e = np.array([np.sqrt(np.mean(x[i:i + f] ** 2) + 1e-12) for i in range(0, len(x) - f, f)])
    keep = np.where(20 * np.log10(e / (e.max() + 1e-12)) > db)[0]
    return x[keep[0] * f:(keep[-1] + 1) * f] if len(keep) else x


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def scale_to(x, db):
    return (x * 10 ** ((db - rms_db(x)) / 20)).astype(np.float32)


def room_tone(n, db, rng):
    white = rng.normal(0, 1, n).astype(np.float32)
    pinkish = lfilter([1.0], [1.0, -0.95], white).astype(np.float32)
    return scale_to(pinkish, db)


def build(audiomnist, rng, pyrng):
    speakers = sorted(glob.glob(os.path.join(audiomnist, "data", "[0-9][0-9]")))
    files = sorted(glob.glob(os.path.join(pyrng.choice(speakers), "*.wav")))
    pyrng.shuffle(files)
    digits = iter(trim(load(f)) for f in files)

    signal = room_tone(TOTAL_S * SR, -60, rng)
    truth = []  # (burst_start, burst_end, [(word_start, word_end), ...])
    slot = TOTAL_S * SR // BURSTS
    for b in range(BURSTS):
        target = pyrng.uniform(6, 14) * SR
        level = -26 if b % 4 else -36  # every fourth utterance is farther away
        words, burst, t = [], [], 0
        while t < target:
            w = next(digits)
            burst.append((t, w))
            words.append((t, t + len(w)))
            # Natural pauses; now and then one longer than the hangover.
            gap = pyrng.uniform(0.12, 0.5) if pyrng.random() > 0.1 else pyrng.uniform(0.8, 1.2)
            t += len(w) + int(gap * SR)
        length = words[-1][1]
        start = b * slot + pyrng.randint(int(2 * SR), slot - length - int(2 * SR))
        audio = np.zeros(length, dtype=np.float32)
        for off, w in burst:
            audio[off:off + len(w)] += w
        audio = scale_to(audio, level)
        signal[start:start + length] += audio
        truth.append((start, start + length, [(start + a, start + c) for a, c in words]))
    return signal, truth


def run_sim(jar, pcm_path):
    out = subprocess.run(["java", "-cp", jar, "ClipAssemblerSimKt", pcm_path],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def evaluate(result, truth):
    clips = [(s * SR // 1000, (s + d) * SR // 1000) for s, d in result["clips"]]
    words = [w for _, _, ws in truth for w in ws]
    speech = sum(b - a for a, b in words)
    covered = 0
    for a, b in words:
        for s, e in clips:
            covered += max(0, min(b, e) - max(a, s))
    in_burst = lambda s, e: sum(max(0, min(e, b1) - max(s, b0)) for b0, b1, _ in truth)
    mostly_silence = sum(1 for s, e in clips if in_burst(s, e) < 0.5 * (e - s))
    margins = []
    for b0, _, _ in truth:
        holder = [s for s, e in clips if s <= b0 < e]
        margins.append((b0 - holder[0]) * 1000 // SR if holder else None)
    return {
        "speech_s": round(speech / SR, 1),
        "utterances_s": round(sum(b - a for a, b, _ in truth) / SR, 1),
        "saved_s": round(result["savedMs"] / 1000, 1),
        "silence_dropped_s": round((result["listenedMs"] - result["savedMs"] - result["tooShortMs"]
                                    - result["silencedMs"]) / 1000, 1),
        "clips": len(clips),
        "speech_kept_pct": round(100 * covered / speech, 1),
        "mostly_silence_clips": mostly_silence,
        "first_word_margin_ms": {"min": min(m for m in margins if m is not None) if any(m is not None for m in margins) else None,
                                 "missed_onsets": sum(1 for m in margins if m is None)},
        "events": result["events"],
    }


def main():
    audiomnist, noise_dir, jar, out_dir = sys.argv[1:5]
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(1)
    pyrng = random.Random(1)
    base, truth = build(audiomnist, rng, pyrng)

    def noise(kind, db):
        x = np.concatenate([load(f) for f in sorted(glob.glob(os.path.join(noise_dir, f"{kind}_*.wav")))])
        x = np.tile(x, int(np.ceil(len(base) / len(x))))[:len(base)]
        return scale_to(x, db)

    call = base.copy()
    call[300 * SR:330 * SR] = 0.0  # Android feeds digital silence during a call
    household = base.copy()
    for kind, at in [("ShuttingDoor", 40), ("Typing", 150), ("Munching", 260), ("ShuttingDoor", 380), ("Typing", 470)]:
        clip = noise(kind, -30)[:12 * SR]
        household[at * SR:at * SR + len(clip)] += clip

    scenarios = {
        "quiet_room": base,
        "fan_ac_-40dB": base + noise("AirConditioner", -40),
        "phone_call_30s": call,
        "household_noise": household,
    }
    report = {}
    for name, x in scenarios.items():
        pcm = os.path.join(out_dir, f"{name}.pcm")
        (np.clip(x, -1, 1) * 32767).astype("<i2").tofile(pcm)
        report[name] = evaluate(run_sim(jar, pcm), truth)
        print(name, json.dumps(report[name]), flush=True)
    with open(os.path.join(out_dir, "h1_sim.json"), "w") as fh:
        json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
