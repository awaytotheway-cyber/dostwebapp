# Listening Phase 2 — Step 1: library and model spike

Date: 2026-10-07 · Phone under test: Moto G64 5G (Dimensity 7025, Android 14/15)

## Recommendation

| Part | Choice | Why |
| --- | --- | --- |
| Runtime | **sherpa-onnx 1.13.8** Android library (Kotlin API, runs ONNX Runtime) | Has both speech detection and speaker recognition, runs inside our Kotlin service, Apache-2.0 |
| Speech detector (VAD) | **Silero VAD** (0.6 MB, MIT) | 0 false triggers on 24 min of household noise; old loudness gate: 180 per hour |
| Speaker model | **3D-Speaker ERes2Net, VoxCeleb** (26.5 MB) | Most accurate and the only one that stayed accurate in noise, chatter and at a distance |
| Backup speaker model | TitaNet-small (NeMo) | Close second, but training-data licence is a Play Store risk (see Licences) |

## How it plugs in

* sherpa-onnx ships one Android library file (`sherpa-onnx-1.13.8.aar`, 50 MB, SHA-256
  `633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96`) with code for 4 CPU types.
  The phone (arm64) needs only `classes.jar`, `libonnxruntime.so` and `libsherpa-onnx-jni.so`
  (checked with `readelf`: the JNI library depends only on ONNX Runtime).
* Plan: keep a trimmed arm64-only copy (about 10 MB) in `plugins/`; the existing Expo config
  plugin copies it into `android/app/libs` and adds it to `app/build.gradle`. No JitPack or
  network needed during the build. Minimum Android version of the library: 5.0 (API 21).
* Kotlin classes used: `Vad` + `SileroVadModelConfig` (32 ms frames, 512 samples) and
  `SpeakerEmbeddingExtractor` (2 s window in, 192 numbers out). Both load from app assets or
  from a file path, so the service can run with JavaScript dead.

## Speaker models compared

Test: AudioMNIST — 60 speakers, all recorded on one microphone (the hard "other people near
the same phone" case). Each speaker enrolled with 5 clips of about 8 s, like the in-app
enrollment. Then 1,800 held-out 2-second windows were scored against every enrolled speaker
(1,800 own-voice tests, 106,200 other-voice tests).

"Kept @1%" = share of the speaker's own windows accepted when only 1% of other people's
windows get through. Prompt target H4: keep ≥ 85% with ≤ 5% others.

| Model | Size | Quiet | AC/fan loud (10 dB) | Others chatting (10 dB) | Others chatting (5 dB) | Across room + echo + fan |
| --- | --- | --- | --- | --- | --- | --- |
| **3D-Speaker ERes2Net** | 26.5 MB | **99.8%** | **99.4%** | **92.9%** | **80.3%** | **95.6%** |
| NeMo TitaNet-small | 40.3 MB | 96.6% | 93.2% | 89.1% | 76.1% | 70.1% |
| WeSpeaker ResNet34-LM | 26.5 MB | 94.9% | 42.9% | 24.3% | 8.4% | 4.6% |
| 3D-Speaker CAM++ | 29.6 MB | 59.2% | 55.5% | – | – | – |
| WeSpeaker CAM++-LM | 29.3 MB | 23.6% | 9.2% | – | – | – |
| Old app method (voice fingerprint), raw score | – | 62.6% | not tested | – | – | – |
| Old app method as shipped ("Balanced") | – | **4.1%** kept | | | | |

Equal error rates (quiet): ERes2Net 0.4%, TitaNet-small 1.8%, ResNet34 2.2%, old fingerprint 9.9%.
At the looser 5% setting ERes2Net keeps 100% in quiet and 97% with chatter at 10 dB.

The two CAM++ models scored far below their published results. That points to a feature
mismatch in these exports, not the architecture; they were dropped rather than debugged.

Why the shipped app kept only 4%: its noise rule requires each clip to be 25 dB above
background. On these 2-second speech windows 91% failed that rule and were discarded as
"unclear", before the voice comparison even ran.

## Speed and memory (desktop proxy)

Desktop: Intel Xeon 2.1 GHz (AVX-512). The phone's fast cores (Cortex-A78, 2.5 GHz) are
roughly 2–4× slower on this kind of work, more if Android moves the work to the small cores
with the screen off.

| | Desktop | Phone estimate | Target |
| --- | --- | --- | --- |
| Silero VAD, one 32 ms frame | 0.15 ms | ~0.5–1 ms | far below 32 ms |
| ERes2Net, one 2 s window, 2 threads | 52 ms (84 ms on 1 thread) | ~150–350 ms | < 500 ms |
| TitaNet-small, 2 threads | 21 ms | ~60–150 ms | < 500 ms |
| ERes2Net extra memory | +78 MB | similar | — |
| Model load | 0.26 s | ~1 s | once per session |

These are estimates. The first test build (Step 2) includes a "Model check" button that
measures the real numbers on the Moto G64 with the screen off. If ERes2Net is over 0.5 s per
window there, the fallbacks are: hop 1.5 s instead of 1 s, or TitaNet-small.

## Speech detector (Silero) on household noise

24 minutes of recorded non-speech noise (air conditioner, copy machine, chewing, doors,
typing, vacuum), each preceded by 1 s of quiet:

| Stage | False clips saved per hour |
| --- | --- |
| Old app loudness gate (HearingService.kt logic) | 180 |
| Silero VAD (threshold 0.5, 0.7 s hangover, ≥ 1 s clips) | 0 |

Silero still kept 99.9% of real speech in the same run, so the zero is not from it being deaf.

## App size

| | arm64 only (recommended) | All 4 CPU types |
| --- | --- | --- |
| sherpa-onnx + ONNX Runtime | ~10 MB download, 27 MB installed | ~50 MB download, 114 MB installed |
| Silero VAD | 0.6 MB | 0.6 MB |
| ERes2Net (if bundled) | 26.5 MB | 26.5 MB |

Play Store delivers only the phone's own CPU type from an app bundle, so "all 4" mainly
affects test APKs. Nearly all phones sold since 2019 are arm64.

## Licences (Play Store / commercial)

| Item | Licence | Commercial use |
| --- | --- | --- |
| sherpa-onnx | Apache-2.0 | Yes |
| ONNX Runtime | MIT | Yes |
| Silero VAD | MIT | Yes |
| 3D-Speaker toolkit (ERes2Net code) | Apache-2.0 | Yes |
| ERes2Net VoxCeleb weights | Released by 3D-Speaker (Apache-2.0 project); trained only on VoxCeleb | Yes, with attribution — **open item:** the ModelScope model card (`iic/speech_eres2net_sv_en_voxceleb_16k`) could not be opened from this environment to confirm its licence field |
| VoxCeleb (training data) | CC BY 4.0; video copyright stays with the original owners | Yes, with attribution |
| WeSpeaker ResNet34 weights | CC BY 4.0 (follows VoxCeleb, per WeSpeaker docs) | Yes, with attribution |
| NeMo TitaNet-small weights | CC BY 4.0 | Model yes, **but** trained partly on Fisher, Switchboard and NIST SRE (LDC corpora with their own licences) — legal review needed before shipping |
| Test data used here (AudioMNIST, MS-SNSD) | MIT | Used only for testing, not shipped |

Attribution needed in the app (About screen and open-source licences list): sherpa-onnx,
ONNX Runtime, Silero VAD, 3D-Speaker/ERes2Net, VoxCeleb (Nagrani et al.).

## Android rule that shapes the schedule

Android 14+ will not let an app switch on a microphone foreground service from the
background — not from a timer (exact alarm) and not after a reboot. It is allowed when the
user taps a notification (or a widget, or the app). Source:
developer.android.com/develop/background-work/services/fgs/restrictions-bg-start.

So, matching what Pratik asked for:

* Pratik picks the times of day listening is allowed.
* When a window starts, DOST posts a notification: "Your listening time has started — Start".
  Tapping Start begins listening (screen can then be off, app closed).
* While listening, the notification has Stop. The in-app button starts and stops too.
* At the end of a window, listening stops by itself (this is allowed from the background).
* After a reboot, the timers are set again; each window still needs the one tap.

## Limits of this test (read before trusting the numbers)

* AudioMNIST is spoken digits in (mostly German-accented) English. The same ten words appear
  in enrollment and testing, which is easier than free conversation. Hindi and Marathi were
  not tested. Real numbers come from calibration on Pratik's phone in Step 9.
* Thresholds here were set with all 60 speakers known. In the app they come from Pratik's
  own enrollment and calibration, so expect somewhat lower numbers.
* "Chatter" and "across the room" are simulated (recorded babble, synthetic echo).
* A recording of Pratik played from another phone was not tested; it will likely pass.

## Reproduce

```
pip install sherpa-onnx==1.13.8 numpy scipy soundfile psutil
python scripts/listening/benchmark_speaker_models.py --models-dir MODELS \
    --audiomnist AudioMNIST --noise-dir MS-SNSD/noise_test --out results.json
python scripts/listening/stress_speaker_models.py MODELS AudioMNIST MS-SNSD/noise_test stress.json
```

Models: GitHub release `k2-fsa/sherpa-onnx` tags `speaker-recongition-models` and
`asr-models` (silero_vad.onnx). Test data: github.com/soerenab/AudioMNIST,
github.com/microsoft/MS-SNSD (`noise_test`). Raw numbers: `step1-results.json`.

SHA-256 of the files tested:

| File | SHA-256 |
| --- | --- |
| 3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx | c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5 |
| nemo_en_titanet_small.onnx | ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e |
| wespeaker_en_voxceleb_resnet34_LM.onnx | e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012 |
| silero_vad.onnx | 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6 |
