#!/usr/bin/env python3
"""
Listening Phase 2, Step 1 spike: compare speaker-embedding models and
Silero VAD on a desktop before anything is built into the app.

What it measures
  * Speaker gate accuracy on AudioMNIST (60 speakers, one microphone, one
    room — the hard case of "other people near the same phone"):
      - enrollment: 5 clips of ~8 s per speaker (like the in-app enrollment)
      - test: 2.0 s windows of held-out speech (the planned speaker window)
      - EER, and own-speech kept at 5% / 1% other-speech accepted
      - the same in fan/AC noise at 20 dB and 10 dB SNR
  * Speed: embedding time for one 2.0 s window (1 and 2 threads), model
    load time, resident memory; Silero VAD time per 32 ms frame.
  * Stage 1+2 false triggers on non-speech household noise (MS-SNSD), for
    the old energy gate versus Silero VAD.

Desktop numbers are a proxy. The real benchmark runs on the phone.

Usage
  python benchmark_speaker_models.py \
      --models-dir DIR --audiomnist DIR --noise-dir DIR --out results.json
"""
import argparse
import glob
import json
import os
import random
import time

import numpy as np
import psutil
import sherpa_onnx
import soundfile as sf
from scipy.signal import resample_poly

SR = 16000
WINDOW_S = 2.0
ENROLL_CLIPS = 5
UTTS_PER_CLIP = 12
TEST_WINDOWS_PER_SPEAKER = 30
NONSPEECH_NOISE = [
    "AirConditioner",
    "CopyMachine",
    "Munching",
    "ShuttingDoor",
    "Typing",
    "VacuumCleaner",
]

CANDIDATES = [
    "wespeaker_en_voxceleb_resnet34_LM.onnx",
    "wespeaker_en_voxceleb_CAM++_LM.onnx",
    "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
    "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx",
    "nemo_en_titanet_small.onnx",
]


def load_16k(path):
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x


def trim(x, thresh_db=-35.0):
    """Cut leading/trailing silence of a single-word recording."""
    frame = 160
    n = len(x) // frame
    if n == 0:
        return x
    e = np.array([np.sqrt(np.mean(x[i * frame:(i + 1) * frame] ** 2) + 1e-12) for i in range(n)])
    db = 20 * np.log10(e / (e.max() + 1e-12))
    idx = np.where(db > thresh_db)[0]
    if len(idx) == 0:
        return x
    return x[idx[0] * frame:(idx[-1] + 1) * frame]


def concat(utts, gap_s=0.12):
    gap = np.zeros(int(gap_s * SR), dtype=np.float32)
    parts = []
    for u in utts:
        parts.append(u)
        parts.append(gap)
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def build_speakers(root, seed=7):
    rng = random.Random(seed)
    speakers = {}
    for d in sorted(glob.glob(os.path.join(root, "data", "[0-9][0-9]"))):
        spk = os.path.basename(d)
        files = sorted(glob.glob(os.path.join(d, "*.wav")))
        rng.shuffle(files)
        utts = [trim(load_16k(f)) for f in files]
        enroll = [
            concat(utts[i * UTTS_PER_CLIP:(i + 1) * UTTS_PER_CLIP])
            for i in range(ENROLL_CLIPS)
        ]
        rest = concat(utts[ENROLL_CLIPS * UTTS_PER_CLIP:])
        win = int(WINDOW_S * SR)
        windows = [rest[i:i + win] for i in range(0, len(rest) - win, win)]
        speakers[spk] = {"enroll": enroll, "windows": windows[:TEST_WINDOWS_PER_SPEAKER]}
    return speakers


def add_noise(x, noise, snr_db, rng):
    if len(noise) < len(x):
        noise = np.tile(noise, int(np.ceil(len(x) / len(noise))))
    start = rng.randint(0, len(noise) - len(x))
    n = noise[start:start + len(x)]
    px = np.mean(x ** 2) + 1e-12
    pn = np.mean(n ** 2) + 1e-12
    return (x + n * np.sqrt(px / (pn * 10 ** (snr_db / 10)))).astype(np.float32)


def make_extractor(path, threads):
    cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=path, num_threads=threads, debug=False, provider="cpu"
    )
    return sherpa_onnx.SpeakerEmbeddingExtractor(cfg)


def embed(ex, x):
    s = ex.create_stream()
    s.accept_waveform(sample_rate=SR, waveform=x)
    s.input_finished()
    e = np.array(ex.compute(s), dtype=np.float32)
    return e / (np.linalg.norm(e) + 1e-12)


def metrics(genuine, impostor):
    genuine = np.asarray(genuine)
    impostor = np.asarray(impostor)
    ths = np.unique(np.concatenate([genuine, impostor]))
    far = np.array([(impostor >= t).mean() for t in ths])
    frr = np.array([(genuine < t).mean() for t in ths])
    i = int(np.argmin(np.abs(far - frr)))
    out = {"eer": float((far[i] + frr[i]) / 2)}
    for target in (0.05, 0.01):
        ok = np.where(far <= target)[0]
        j = ok[0] if len(ok) else len(ths) - 1
        out[f"kept_at_far{int(target * 100)}"] = float(1 - frr[j])
        out[f"threshold_at_far{int(target * 100)}"] = float(ths[j])
    return out


def score_model(path, speakers, noise, rng):
    ex = make_extractor(path, 2)
    refs = {}
    for spk, d in speakers.items():
        embs = [embed(ex, c) for c in d["enroll"]]
        r = np.mean(embs, axis=0)
        refs[spk] = r / np.linalg.norm(r)
    results = {}
    conditions = {"quiet": None, "ac_20db": 20, "ac_10db": 10}
    for name, snr in conditions.items():
        wins = {}
        for spk, d in speakers.items():
            ws = d["windows"] if snr is None else [add_noise(w, noise, snr, rng) for w in d["windows"]]
            wins[spk] = np.stack([embed(ex, w) for w in ws])
        genuine, impostor = [], []
        for spk, ref in refs.items():
            for other, e in wins.items():
                s = e @ ref
                (genuine if other == spk else impostor).extend(s.tolist())
        results[name] = metrics(genuine, impostor)
    return results


def time_model(path, x):
    proc = psutil.Process()
    rss0 = proc.memory_info().rss
    t0 = time.perf_counter()
    ex1 = make_extractor(path, 1)
    load_s = time.perf_counter() - t0
    out = {"load_s": load_s, "dim": ex1.dim}
    for threads, ex in ((1, ex1), (2, make_extractor(path, 2))):
        embed(ex, x)  # warm-up
        n = 20
        t0 = time.perf_counter()
        for _ in range(n):
            embed(ex, x)
        out[f"ms_per_2s_window_{threads}t"] = (time.perf_counter() - t0) / n * 1000
    out["rss_mb_delta"] = (proc.memory_info().rss - rss0) / 1e6
    return out


def vad_config(path):
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = path
    cfg.silero_vad.threshold = 0.5
    cfg.silero_vad.min_silence_duration = 0.7  # planned hangover
    cfg.silero_vad.min_speech_duration = 0.1  # ~3 frames
    cfg.silero_vad.window_size = 512
    cfg.silero_vad.max_speech_duration = 300
    cfg.sample_rate = SR
    cfg.num_threads = 1
    return cfg


def time_vad(path, x):
    model = sherpa_onnx.VadModel.create(vad_config(path))
    frames = [x[i:i + 512] for i in range(0, len(x) - 512, 512)]
    for f in frames[:50]:
        model.is_speech(f)
    t0 = time.perf_counter()
    for f in frames:
        model.is_speech(f)
    return (time.perf_counter() - t0) / len(frames) * 1000


def silero_segments(path, x):
    vad = sherpa_onnx.VoiceActivityDetector(vad_config(path), buffer_size_in_seconds=600)
    for i in range(0, len(x), 512):
        vad.accept_waveform(x[i:i + 512])
    vad.flush()
    segs = []
    while not vad.empty():
        segs.append(len(vad.front.samples) / SR)
        vad.pop()
    return segs


def energy_gate_segments(x):
    """The old HearingService.kt energy gate, re-implemented for comparison."""
    frame = 320  # 20 ms
    floor_frames, floor_sum, floor, calibrated = 0, 0.0, 0.0, False
    in_speech, run, silence_ms, seg_len, segs = False, 0, 0, 0, []
    for i in range(0, len(x) - frame, frame):
        rms = float(np.sqrt(np.mean(x[i:i + frame] ** 2)))
        if not calibrated:
            floor_sum += rms
            floor_frames += 1
            if floor_frames >= 25:
                floor, calibrated = floor_sum / floor_frames, True
            continue
        speech = rms >= max(0.006, floor * 2.5)
        if speech:
            run += 1
            silence_ms = 0
            if not in_speech and run >= 4:
                in_speech, seg_len = True, 0
            if in_speech:
                seg_len += frame
        else:
            run = 0
            if in_speech:
                seg_len += frame
                silence_ms += 20
                if silence_ms >= 800:
                    segs.append(seg_len / SR)
                    in_speech, silence_ms = False, 0
            else:
                floor = floor * 0.98 + rms * 0.02
    if in_speech:
        segs.append(seg_len / SR)
    return segs


def speech_recall(vad_path, speakers):
    """Share of real speech the VAD keeps, so 0 false triggers means something."""
    speech_s, kept_s = 0.0, 0.0
    lead = np.zeros(SR, dtype=np.float32)
    for d in speakers.values():
        x = np.concatenate([lead, d["enroll"][0], lead])
        speech_s += len(d["enroll"][0]) / SR
        kept_s += min(sum(silero_segments(vad_path, x)), len(d["enroll"][0]) / SR)
    return kept_s / speech_s


def false_triggers(vad_path, noise_dir):
    total_s, old_n, new_n = 0.0, 0, 0
    per_kind = {}
    for kind in NONSPEECH_NOISE:
        for f in sorted(glob.glob(os.path.join(noise_dir, f"{kind}_*.wav"))):
            x = load_16k(f)
            # lead-in of quiet room so both gates can learn the floor
            x = np.concatenate([np.random.default_rng(0).normal(0, 3e-4, SR).astype(np.float32), x])
            dur = len(x) / SR
            old = [s for s in energy_gate_segments(x) if s >= 1.5]
            new = [s for s in silero_segments(vad_path, x) if s >= 1.0]
            total_s += dur
            old_n += len(old)
            new_n += len(new)
            k = per_kind.setdefault(kind, {"seconds": 0.0, "old": 0, "silero": 0})
            k["seconds"] += dur
            k["old"] += len(old)
            k["silero"] += len(new)
    hours = total_s / 3600
    return {
        "noise_minutes": total_s / 60,
        "old_energy_gate_clips_per_hour": old_n / hours,
        "silero_vad_clips_per_hour": new_n / hours,
        "per_kind": per_kind,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dir", required=True)
    ap.add_argument("--audiomnist", required=True)
    ap.add_argument("--noise-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", nargs="*", default=CANDIDATES)
    args = ap.parse_args()

    rng = random.Random(11)
    print("loading AudioMNIST ...", flush=True)
    speakers = build_speakers(args.audiomnist)
    noise = np.concatenate(
        [load_16k(f) for f in sorted(glob.glob(os.path.join(args.noise_dir, "AirConditioner_*.wav")))]
    )
    sample_window = speakers["01"]["windows"][0]
    vad_path = os.path.join(args.models_dir, "silero_vad.onnx")

    report = {
        "speakers": len(speakers),
        "test_windows": sum(len(d["windows"]) for d in speakers.values()),
        "vad_ms_per_32ms_frame": time_vad(vad_path, np.concatenate([d["enroll"][0] for d in speakers.values()])),
        "vad_speech_recall": speech_recall(vad_path, speakers),
        "nonspeech_false_triggers": false_triggers(vad_path, args.noise_dir),
        "models": {},
    }
    print(json.dumps({k: v for k, v in report.items() if k != "models"}, indent=1), flush=True)

    for name in args.models:
        path = os.path.join(args.models_dir, name)
        print(f"--- {name}", flush=True)
        r = {"size_mb": os.path.getsize(path) / 1e6}
        r.update(time_model(path, sample_window))
        r["accuracy"] = score_model(path, speakers, noise, rng)
        report["models"][name] = r
        print(json.dumps(r, indent=1), flush=True)
        with open(args.out, "w") as fh:
            json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
