# Listening on iOS

Listening sessions now have an iOS implementation. It is one codebase with
Android: only the native layer differs, and everything above it — speaker
gate, transcription, emotion tags, session summaries, the Journey screen —
is the same shared JavaScript.

## Layout

```
plugins/hearing-service/
  kotlin/      Android native layer (unchanged)
  ios/         iOS native layer: the Swift twin of kotlin/
  ios-tests/   parity check: Swift vs Kotlin on identical audio
  expo-module.config.json   makes this folder an iOS-only Expo module
lib/hearing/   shared by both platforms
```

`package.json` sets `expo.autolinking.nativeModulesDir` to `./plugins`, so
Expo autolinks `plugins/hearing-service` as a local module. Its config limits
it to Apple platforms; the generated Android project is byte-for-byte the same
as before this change.

## How the two platforms line up

| Android (Kotlin)          | iOS (Swift)                        | Role |
|---------------------------|------------------------------------|------|
| `HearingService.kt`       | `HearingSession.swift`             | session lifecycle, events |
| `processFrame` and helpers | `HearingVAD.swift`                 | voice-activity detection, segmenting |
| `AudioRecord`             | `AudioCapture.swift`               | mic → 16 kHz mono PCM16, 20 ms frames |
| `EnrollmentRecorder.kt`   | `EnrollmentRecorder.swift`         | voice enrolment clip |
| `SpeakerEmbedder.kt`      | `SpeakerEmbedder.swift`            | ONNX speaker embedding (same model, ORT 1.20.0) |
| `HearingModule.kt`        | `DostHearingModule.swift`          | the JS bridge |

Same functions, same five events, same payloads. JavaScript picks the module
in `lib/hearing/hearingBackend.ts` and never asks which platform it is on,
apart from two iOS-only details: the microphone prompt (`permissions.ts`) and
finishing a session iOS ended by itself (`pipeline.ts`).

## What differs on iOS, and why

- **No notification.** iOS shows its own microphone indicator for the whole
  session. That is the iOS equivalent of Android's ongoing notification.
- **A session must be started in the app.** iOS does not let an app begin
  recording from the background. Once started, it keeps listening when the
  person leaves the app (the `audio` background mode).
- **Interruptions.** Phone calls, Siri or another app can take the
  microphone. Capture pauses and resumes afterwards. If iOS will not give the
  microphone back, the session ends cleanly and its summary is still written.
- **Other audio keeps playing.** The audio session mixes with others, so music
  or a podcast is not stopped by a listening session.
- **No automatic gain.** The session uses iOS's measurement mode, matching
  Android's voice-recognition source. Automatic levelling would flatten the
  loudness the pipeline measures.

## What has been verified, and what has not

Verified in this repository:

- `HearingVAD.swift` and the PCM byte layout produce **identical output to
  the real Android code**: every tick (floating-point values compared as raw
  bits) and every segment (compared as the exact base64 sent to JavaScript),
  on 52 s of audio built to hit every branch. Run it with
  `plugins/hearing-service/ios-tests/run_parity.sh`; it fails on any
  difference (confirmed by deliberately changing one constant).
- Every Swift file parses. Expo autolinking resolves the module for iOS and not
  for Android. CocoaPods evaluates the podspec. `expo prebuild` writes the
  Podfile line and the Info.plist keys. Both JavaScript bundles build, and the
  JavaScript has unit tests for platform selection.

**Not verified: the Swift that uses Apple's frameworks** (AVFoundation,
ExpoModulesCore, ONNX Runtime). Type-checking it needs Xcode, which only runs
on macOS, so the first EAS iOS build is its real compile. The ONNX and Expo
calls were written against the real, version-matched signatures, but expect a
round or two of build fixes.

## Testing on an iPhone

Build (the `preview` profile builds for the simulator only on iOS):

```bash
npx eas build --platform ios --profile testflight
```

Then, on the phone:

1. Open Listening session → enrol your voice. The microphone prompt appears
   the first time.
2. Start a session and talk for a minute. The live dot should move and
   segments should count up.
3. Lock the phone or switch apps for a minute while talking, then come back.
   The session should still be running and segments should have arrived.
4. Take or make a short phone call mid-session. Afterwards the session should
   either have resumed, or have ended on its own with its summary saved.
5. Stop the session, then open Your Journey and check "From listening".

## Permission wording

The microphone permission text changed. It used to say "Nothing is recorded
or stored", which is not accurate once listening sessions exist: audio is held
in memory while it is processed, and with cloud transcription switched on,
segments are sent for transcription. It now reads:

> DOST uses the microphone to turn your speech into text, for voice notes and
> during listening sessions you start yourself. DOST never saves the audio.

Apple reviews this text, so it should be checked by whoever owns the app's
privacy wording.
