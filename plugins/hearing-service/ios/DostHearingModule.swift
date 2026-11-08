import ExpoModulesCore

/// JS bridge for listening on iOS: the counterpart of HearingModule.kt.
///
/// Same functions, same event names, same payloads as Android, so the
/// shared pipeline in lib/hearing/ runs unchanged. The one iOS-only
/// addition is `requestMicrophonePermission`, because iOS asks for the
/// microphone through its own system prompt rather than PermissionsAndroid.
///
/// Built as an Expo module rather than a classic React Native module:
/// Expo modules are first-class under the New Architecture (which this
/// app has on), and their events need no extra bridging.
public class DostHearingModule: Module {
  private let session = HearingSession()
  private let enrollment = EnrollmentRecorder()
  private let embedder = SpeakerEmbedder()

  public func definition() -> ModuleDefinition {
    Name("DostHearing")

    Events(
      "HearingSessionStarted",
      "HearingSessionStopped",
      "HearingSpeechSegment",
      "HearingTick",
      "HearingStartError"
    )

    OnCreate {
      self.session.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnDestroy {
      self.session.stop(userRequested: false)
      self.enrollment.cancel()
      self.embedder.release()
    }

    AsyncFunction("requestMicrophonePermission") { (promise: Promise) in
      HearingAudioSession.requestMicPermission { granted in
        promise.resolve(granted)
      }
    }

    AsyncFunction("startSession") { (promise: Promise) in
      self.session.start { error in
        if let error = error {
          promise.reject(error.code, error.message)
        } else {
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("stopSession") { (promise: Promise) in
      self.session.stop(userRequested: true) {
        promise.resolve(true)
      }
    }

    AsyncFunction("isSessionActive") { () -> Bool in
      self.session.isRunning
    }

    AsyncFunction("captureEnrollmentClip") { (durationMs: Int, promise: Promise) in
      self.enrollment.capture(durationMs: durationMs, sessionActive: self.session.isRunning) { result in
        switch result {
        case .success(let clip): promise.resolve(clip)
        case .failure(let e): promise.reject(e.code, e.message)
        }
      }
    }

    AsyncFunction("cancelEnrollmentCapture") { () -> Bool in
      self.enrollment.cancel()
      return true
    }

    AsyncFunction("computeSpeakerEmbedding") { (modelPath: String, featuresBase64: String, frames: Int, promise: Promise) in
      self.embedder.embed(modelPath: modelPath, featuresBase64: featuresBase64, frames: frames) { result in
        switch result {
        case .success(let embedding): promise.resolve(embedding)
        case .failure(let e): promise.reject(e.code, e.message)
        }
      }
    }

    AsyncFunction("releaseSpeakerModel") { () -> Bool in
      self.embedder.release()
      return true
    }
  }
}
