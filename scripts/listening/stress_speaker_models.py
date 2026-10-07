#!/usr/bin/env python3
"""
Listening Phase 2, Step 1 spike: harder conditions for the shortlisted
speaker models — other people chatting in the background, and the phone
across the room (echo + fan noise). Reuses the dataset and scoring from
benchmark_speaker_models.py.

Usage
  python stress_speaker_models.py MODELS_DIR AUDIOMNIST_DIR NOISE_DIR OUT_JSON
"""
import glob
import json
import os
import random
import sys

import numpy as np
from scipy.signal import fftconvolve

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchmark_speaker_models as b  # noqa: E402

SHORTLIST = [
    "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx",
    "wespeaker_en_voxceleb_resnet34_LM.onnx",
    "nemo_en_titanet_small.onnx",
]


def main():
    models_dir, root, noise_dir, out = sys.argv[1:5]
    rng = random.Random(5)
    speakers = b.build_speakers(root)

    def noise_of(kind):
        files = sorted(glob.glob(os.path.join(noise_dir, f"{kind}_*.wav")))
        return np.concatenate([b.load_16k(f) for f in files])

    babble = noise_of("Babble")
    ac = noise_of("AirConditioner")

    # Synthetic room: exponentially decaying noise tail, RT60 0.6 s.
    g = np.random.default_rng(3)
    t = np.arange(int(0.6 * b.SR)) / b.SR
    rir = (g.normal(0, 1, len(t)) * np.exp(-6.9 * t / 0.6)).astype(np.float32)
    rir[0] = 4.0
    rir /= np.linalg.norm(rir)

    def far(x):
        y = fftconvolve(x, rir)[: len(x)].astype(np.float32)
        return b.add_noise(y, ac, 15, rng)

    conditions = {
        "babble_10db": lambda x: b.add_noise(x, babble, 10, rng),
        "babble_5db": lambda x: b.add_noise(x, babble, 5, rng),
        "far_reverb_ac15": far,
    }

    results = {}
    for name in SHORTLIST:
        ex = b.make_extractor(os.path.join(models_dir, name), 2)
        refs = {}
        for spk, d in speakers.items():
            r = np.mean([b.embed(ex, c) for c in d["enroll"]], axis=0)
            refs[spk] = r / np.linalg.norm(r)
        results[name] = {}
        for cname, f in conditions.items():
            wins = {
                spk: np.stack([b.embed(ex, f(w)) for w in d["windows"]])
                for spk, d in speakers.items()
            }
            genuine, impostor = [], []
            for spk, ref in refs.items():
                for other, e in wins.items():
                    (genuine if other == spk else impostor).extend((e @ ref).tolist())
            results[name][cname] = b.metrics(genuine, impostor)
            print(name, cname, json.dumps(results[name][cname]), flush=True)
    with open(out, "w") as fh:
        json.dump(results, fh, indent=1)


if __name__ == "__main__":
    main()
