import AVFoundation

/// One-shot short capture for speaker enrollment: the iOS counterpart of
/// EnrollmentRecorder.kt.
///
/// Records the requested duration (clamped to 2..20 s) into memory and
/// hands it back as base64 PCM16. Captured exactly like a listening
/// session (same AudioCapture, same 16 kHz mono PCM16) so an enrolled
/// voiceprint matches what real sessions produce. Nothing touches disk;
/// the buffer is zeroed before release.
final class EnrollmentRecorder {
  static let minDurationMs = 2_000
  static let maxDurationMs = 20_000
  /// Extra time allowed beyond the requested duration before giving up,
  /// in case the microphone delivers nothing (Android has no such guard,
  /// but there a stalled read can't leave a promise hanging forever).
  static let watchdogGraceMs = 5_000

  typealias Completion = (Result<[String: Any], HearingError>) -> Void

  private let queue = DispatchQueue(label: "com.dost.hearing.enrollment", qos: .userInitiated)
  private var capture: AudioCapture?
  private var buffer: UnsafeMutableBufferPointer<Int16>?
  private var written = 0
  private var completion: Completion?
  private var watchdog: DispatchWorkItem?

  /// - Parameter sessionActive: a listening session owns the microphone;
  ///   enrollment is refused rather than fought over.
  func capture(durationMs: Int, sessionActive: Bool, _ done: @escaping Completion) {
    queue.async {
      if self.completion != nil {
        done(.failure(HearingError(code: "ENROLLMENT_BUSY", message: "An enrollment capture is already in progress")))
        return
      }
      if sessionActive {
        done(.failure(HearingError(code: "ENROLLMENT_BUSY", message: "Stop the listening session before recording your voice")))
        return
      }
      guard HearingAudioSession.micPermissionGranted() else {
        done(.failure(.micPermissionDenied))
        return
      }

      let clamped = min(max(durationMs, EnrollmentRecorder.minDurationMs), EnrollmentRecorder.maxDurationMs)
      let total = HearingVAD.sampleRate * clamped / 1000
      let buf = UnsafeMutableBufferPointer<Int16>.allocate(capacity: total)
      for i in 0..<total { buf[i] = 0 }
      self.buffer = buf
      self.written = 0
      self.completion = done

      let cap = AudioCapture(
        queue: self.queue,
        onFrame: { [weak self] frame in self?.append(frame) },
        onFailure: { [weak self] _ in self?.finish(failure: HearingError(code: "CAPTURE_ERROR", message: "The microphone changed during recording")) }
      )
      do {
        try HearingAudioSession.activate()
        try cap.start()
      } catch {
        self.capture = cap
        self.finish(failure: HearingError(code: "AUDIO_INIT", message: "Could not start the microphone: \(error.localizedDescription)"))
        return
      }
      self.capture = cap

      let dog = DispatchWorkItem { [weak self] in
        guard let self = self else { return }
        if self.written == 0 {
          self.finish(failure: HearingError(code: "CAPTURE_ERROR", message: "No audio arrived from the microphone"))
        } else {
          self.finish(failure: nil)
        }
      }
      self.watchdog = dog
      self.queue.asyncAfter(
        deadline: .now() + .milliseconds(clamped + EnrollmentRecorder.watchdogGraceMs),
        execute: dog
      )
    }
  }

  /// Like Android's cancel(): stops early and resolves with whatever was
  /// captured so far.
  func cancel() {
    queue.async { self.finish(failure: nil) }
  }

  // ─── internals (queue only) ─────────────────────────────────────

  private func append(_ frame: UnsafeBufferPointer<Int16>) {
    guard let buf = buffer, completion != nil else { return }
    let n = min(frame.count, buf.count - written)
    for i in 0..<n { buf[written + i] = frame[i] }
    written += n
    if written >= buf.count { finish(failure: nil) }
  }

  private func finish(failure: HearingError?) {
    guard let done = completion else { return }
    completion = nil
    watchdog?.cancel()
    watchdog = nil
    capture?.stop()
    capture = nil
    HearingAudioSession.deactivate()

    let count = written
    let result: Result<[String: Any], HearingError>
    if let failure = failure {
      result = .failure(failure)
    } else if let buf = buffer {
      let b64 = pcm16Base64(UnsafeBufferPointer(rebasing: buf[0..<count]))
      result = .success([
        "pcmBase64": b64,
        "sampleRate": HearingVAD.sampleRate,
        // Integer division, as Kotlin's `written * 1000L / SAMPLE_RATE`.
        "durationMs": Double(count * 1000 / HearingVAD.sampleRate),
      ])
    } else {
      result = .failure(HearingError(code: "CAPTURE_ERROR", message: "capture failed"))
    }

    // Zero and free the source before resolving, as on Android.
    if let buf = buffer {
      for i in 0..<buf.count { buf[i] = 0 }
      buf.deallocate()
    }
    buffer = nil
    written = 0
    done(result)
  }
}
