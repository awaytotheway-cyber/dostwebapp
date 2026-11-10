#!/usr/bin/env python3
"""
Deterministic 16 kHz mono PCM16 test stream for the VAD parity check.

Each stretch exists to hit one branch of HearingService.kt's processFrame:
calibration, a blip shorter than the onset, a segment too short to keep,
a pause shorter than the hangover (must stay ONE segment), a rising
noise floor, 32 s of unbroken speech overflowing the 30 s ring, and speech
still in progress when the stream ends (in flight: never emitted).

Usage: make_stream.py OUT.pcm   (writes raw little-endian int16)
"""
import math, struct, sys

SR = 16000
FRAME = 320
out = []
seed = 12345

def rnd():
    global seed
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    return seed / 0x7FFFFFFF * 2 - 1

def noise(sec, amp):
    for _ in range(int(sec * SR)):
        out.append(amp * rnd())

def speech(sec, amp=0.12, f0=140.0):
    n = int(sec * SR)
    for i in range(n):
        t = i / SR
        # syllable-rate envelope so the level isn't flat
        env = 0.55 + 0.45 * math.sin(2 * math.pi * 4.0 * t) ** 2
        f = f0 * (1 + 0.08 * math.sin(2 * math.pi * 0.7 * t))
        v = sum(math.sin(2 * math.pi * f * k * t) / k for k in (1, 2, 3))
        out.append(amp * env * v / 1.8 + 0.002 * rnd())

noise(0.6, 0.002)            # calibration + quiet room
speech(2.5); noise(1.2, 0.002)   # an ordinary utterance
speech(0.06); noise(0.6, 0.002)  # 3-frame blip: below the 4-frame onset
speech(0.2); noise(1.2, 0.002)   # too short once cut: dropped, not emitted
speech(2.0); noise(0.5, 0.002); speech(2.0); noise(1.2, 0.002)  # pause < hangover
noise(3.0, 0.004)            # room gets louder: floor must track it
speech(1.8, amp=0.15); noise(1.2, 0.004)
speech(32.0, amp=0.1)        # overflows the 30 s ring mid-speech
noise(1.0, 0.002)
speech(1.0)                  # still talking at the end: in flight

# whole frames only, as AudioRecord / AudioCapture deliver
while len(out) % FRAME:
    out.append(0.0)

with open(sys.argv[1], "wb") as f:
    for x in out:
        v = max(-1.0, min(1.0, x))
        f.write(struct.pack("<h", int(round(v * 32767))))
print(f"{len(out)} samples, {len(out) // FRAME} frames, {len(out) / SR:.1f} s")
