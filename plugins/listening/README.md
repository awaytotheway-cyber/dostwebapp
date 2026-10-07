# Native listening pipeline

Android-only. `withListening.js` (listed in `app.json`) copies everything here into
the native project at prebuild. Background and decisions: `docs/listening/`.

## Kotlin (`kotlin/`, package `com.dost.app.listening`)

| File | Role |
| --- | --- |
| `ListenConfig.kt` | Every tunable number |
| `ListenService.kt` | Foreground service: notification, wake lock, guards, stop reasons, log lines |
| `CapturePipeline.kt` | AudioRecord thread → frame queue → processing thread; retries, overrun counts |
| `ClipAssembler.kt` | Stage 1 gate, pre-roll, hangover, min/max clip, mic-taken check (no Android calls; desktop-testable) |
| `EnergyGate.kt` | Adaptive noise floor |
| `PcmRing.kt` | RAM pre-roll buffer |
| `AacSegmentWriter.kt` | Stage 4: AAC-LC 32 kbps → `.m4a` (`.part` until finished) |
| `SessionLog.kt` | `voice/session_log.jsonl` |
| `VoicePaths.kt` | `filesDir/voice/` layout |
| `ModelCheck.kt` | On-phone speed/memory check of the models |
| `ListenModule.kt`, `ListenPackage.kt` | JavaScript bridge (start, stop, status, model check) |

Desktop test of the clip logic: `scripts/listening/sim/`.

## Vendored binaries

| File | Source | SHA-256 | Licence |
| --- | --- | --- | --- |
| `vendor/sherpa-onnx-1.13.8-arm64-v8a.aar` | `sherpa-onnx-1.13.8.aar` from github.com/k2-fsa/sherpa-onnx release v1.13.8 (SHA-256 `633c2432…bd96`), trimmed to `classes.jar`, `libsherpa-onnx-jni.so`, `libonnxruntime.so` for arm64-v8a, plus a keep rule for R8 | `d9d6758cf24f2c0b7ce85f567747819058f59bfc1d2753210eb995a59b8ea7dc` | sherpa-onnx Apache-2.0; ONNX Runtime MIT |
| `models/dost_silero_vad.onnx` | `silero_vad.onnx`, release `asr-models` of k2-fsa/sherpa-onnx | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` | Silero VAD, MIT |
| `models/dost_speaker_eres2net.onnx` | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx`, release `speaker-recongition-models` of k2-fsa/sherpa-onnx (from ModelScope `iic/speech_eres2net_sv_en_voxceleb_16k`) | `c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5` | 3D-Speaker (Apache-2.0); trained on VoxCeleb (CC BY 4.0) — attribution required; model-card licence still to confirm |

The app must credit sherpa-onnx, ONNX Runtime, Silero VAD, 3D-Speaker/ERes2Net and
VoxCeleb (Nagrani et al.) in its About / open-source licences screen before release.
