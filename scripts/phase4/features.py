"""
Faithful Python port of lib/hearing/acousticFeatures.ts and the arousal
heuristic in lib/hearing/acousticInference.ts.

The point of this port is that the validation measures *what actually
ships*, not a tidied-up version of it. Where the TypeScript does
something odd, this does the same odd thing, and the oddity is called
out in a comment rather than quietly fixed.

Deliberate exception: `pitch_variability_pre_fix` is an extra feature
the app does NOT compute. It reproduces the voicing bug that was in the
app until the normalisation fix, so the clips can show what that fix
actually bought. See estimate_pitch_contour.
"""

from __future__ import annotations

import math
import subprocess
import wave
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np

TARGET_SAMPLE_RATE = 16_000


@dataclass
class AcousticFeatures:
    rms_energy: float
    pitch_mean_hz: float
    pitch_variability: float
    speaking_rate_wpm: float
    silence_ratio: float
    vocal_stress_index: float
    # Not in the app. The pre-fix voicing behaviour, measured alongside
    # so we can see what the normalisation fix changed on real speech.
    pitch_variability_pre_fix: float
    voiced_fraction: float

    def as_dict(self) -> dict:
        return asdict(self)


def load_pcm(path: Path, scratch_dir: Path) -> tuple[np.ndarray, int]:
    """
    Decode any audio file to the same shape the phone feeds the pipeline:
    16 kHz, mono, float32 in [-1, 1].

    ffmpeg does the decode so .m4a straight off a phone works. The clip
    is untrusted input, so it is passed as an argument and written to a
    directory of ours, never executed from.
    """
    out = scratch_dir / (path.stem + ".16k.wav")
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
            "-i", str(path),
            "-ac", "1", "-ar", str(TARGET_SAMPLE_RATE),
            "-c:a", "pcm_s16le",
            str(out),
        ],
        check=True,
    )
    with wave.open(str(out), "rb") as w:
        frames = w.readframes(w.getnframes())
        rate = w.getframerate()
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    return pcm, rate


def estimate_pitch_contour(pcm: np.ndarray, sample_rate: int) -> tuple[list[float], list[float]]:
    """
    Short-window autocorrelation pitch, 70–400 Hz.

    Returns (app_contour, pre_fix_contour).

    app_contour matches what ships: the correlation is divided by the
    window's own energy before the 0.3 voicing test, so the threshold
    asks "is this periodic?" and the answer does not change when the
    same speech is recorded louder or softer.

    pre_fix_contour reproduces the bug the app had until that fix, where
    the raw correlation was compared against 0.3. Raw correlation scales
    with energy, so the test was really a loudness gate — quiet voiced
    speech came back as 0 Hz and loud noise came back with a pitch. It is
    kept only so the validation can report what the fix changed.
    """
    window_size = int(sample_rate * 0.04)  # 40 ms
    hop = max(1, window_size // 2)
    min_lag = max(1, sample_rate // 400)
    max_lag = sample_rate // 70

    app_contour: list[float] = []
    pre_fix_contour: list[float] = []

    for start in range(0, max(0, len(pcm) - window_size), hop):
        window = pcm[start:start + window_size]
        best_lag, best_corr, best_norm = 0, 0.0, 0.0
        energy = float(np.dot(window, window)) or 1e-12

        for lag in range(min_lag, max_lag + 1):
            a = window[: window_size - lag]
            b = window[lag:window_size]
            corr = float(np.dot(a, b))
            if corr > best_corr:
                best_corr, best_lag = corr, lag
                best_norm = corr / energy

        app_contour.append(sample_rate / best_lag if best_lag > 0 and best_norm > 0.3 else 0.0)
        pre_fix_contour.append(sample_rate / best_lag if best_lag > 0 and best_corr > 0.3 else 0.0)

    return app_contour, pre_fix_contour


def _variability(contour: list[float]) -> float:
    voiced = [p for p in contour if p > 0]
    if len(voiced) <= 1:
        return 0.0
    mean = sum(voiced) / len(voiced)
    if mean <= 0:
        return 0.0
    var = sum((p - mean) ** 2 for p in voiced) / len(voiced)
    return math.sqrt(var) / mean


def extract_features(
    pcm: np.ndarray,
    sample_rate: int,
    word_count: int,
    duration_seconds: float,
) -> AcousticFeatures:
    """Mirrors extractAcousticFeatures(). word_count replaces the
    transcript, since the validation clips use a known fixed sentence."""
    if pcm.size == 0 or sample_rate <= 0:
        return AcousticFeatures(0, 0, 0, 0, 0, 0, 0, 0)

    rms = float(np.sqrt(np.mean(pcm * pcm)))
    rms_energy = min(1.0, rms * 4)

    app_contour, pre_fix_contour = estimate_pitch_contour(pcm, sample_rate)
    voiced = [p for p in app_contour if p > 0]
    pitch_mean_hz = sum(voiced) / len(voiced) if voiced else 0.0
    pitch_variability = _variability(app_contour)
    pitch_variability_pre_fix = _variability(pre_fix_contour)
    voiced_fraction = (len(voiced) / len(app_contour)) if app_contour else 0.0

    speaking_rate_wpm = (word_count / duration_seconds) * 60 if duration_seconds > 0 else 0.0

    # Silence: fraction of 20 ms frames under an ABSOLUTE 0.01 RMS floor.
    # Absolute, so it moves with recording gain and mic distance — a real
    # confound the recording instructions try to hold constant.
    frame = max(1, int(sample_rate * 0.02))
    silent = total = 0
    for i in range(0, max(0, len(pcm) - frame), frame):
        f = pcm[i:i + frame]
        if float(np.sqrt(np.mean(f * f))) < 0.01:
            silent += 1
        total += 1
    silence_ratio = silent / total if total else 0.0

    rate_norm = min(1.0, speaking_rate_wpm / 200)
    vocal_stress_index = min(
        1.0,
        pitch_variability * 0.4 + rate_norm * 0.4 + (1 - silence_ratio) * 0.2,
    )

    return AcousticFeatures(
        rms_energy=rms_energy,
        pitch_mean_hz=pitch_mean_hz,
        pitch_variability=pitch_variability,
        speaking_rate_wpm=speaking_rate_wpm,
        silence_ratio=silence_ratio,
        vocal_stress_index=vocal_stress_index,
        pitch_variability_pre_fix=pitch_variability_pre_fix,
        voiced_fraction=voiced_fraction,
    )


def shipped_arousal(f: AcousticFeatures) -> float:
    """The exact heuristic in acousticInference.ts: loudness + pace."""
    return min(1.0, f.rms_energy * 0.5 + min(1.0, f.speaking_rate_wpm / 200) * 0.5)
