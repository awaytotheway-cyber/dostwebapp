import AVFoundation
import UIKit

/// A listening session: the iOS counterpart of HearingService.kt.
///
/// Emits the same five events with the same payloads, so the shared
/// pipeline in lib/hearing/pipeline.ts runs unchanged on both platforms:
///
///   HearingSessionStarted  { startedAt, sampleRate }
///   HearingSessionStopped  { startedAt, endedAt, totalMs, speechMs, segmentsEmitted, userRequested }
///   HearingSpeechSegment   { pcmBase64, sampleRate, durationMs, capturedAt }
///   HearingTick            { speech, rms, noiseFloor, calibrating, totalMs, speechMs }
///   HearingStartError      { reason }
///
/// Where iOS differs from Android:
///
///   - No foreground service or notification. Background capture is
///     allowed by the `audio` background mode (added by the config
///     plugin) for as long as capture keeps running, and iOS shows its
///     own microphone indicator throughout. That indicator is the honest
///     equivalent of Android's ongoing notification.
///   - A session can only be *started* from the foreground. iOS does not
///     allow an app to begin recording from the background.
///   - Phone calls, Siri and other apps can take the microphone. Capture
///     pauses and resumes when the interruption ends; if it cannot
///     resume, the session ends and says so (`userRequested: false`).
///
/// Unchanged from Android: session-based only, started and stopped by
/// explicit user action, and no audio is ever written to disk.
final class HearingSession {
  /// Set by the module. Called on the session queue.
  var emit: ((String, [String: Any?]) -> Void)?

  private let queue = DispatchQueue(label: "com.dost.hearing.session", qos: .userInitiated)
  private let vad = HearingVAD()
  private var capture: AudioCapture?
  private var observers: [NSObjectProtocol] = []
  private var startedAt: Double = 0
  private var interrupted = false

  // `isRunning` is read from the module's thread; everything else is
  // queue-only.
  private let lock = NSLock()
  private var running = false
  var isRunning: Bool {
    lock.lock(); defer { lock.unlock() }
    return running
  }
  private func setRunning(_ value: Bool) {
    lock.lock(); running = value; lock.unlock()
  }

  init() {
    vad.onTick = { [weak self] t in
      self?.emit?("HearingTick", [
        "speech": t.speech,
        "rms": t.rms,
        "noiseFloor": t.noiseFloor,
        "calibrating": t.calibrating,
        "totalMs": t.totalMs,
        "speechMs": t.speechMs,
      ])
    }
    vad.onSegment = { [weak self] samples, durationMs in
      guard let self = self else { return }
      self.emit?("HearingSpeechSegment", [
        "pcmBase64": pcm16Base64(samples),
        "sampleRate": HearingVAD.sampleRate,
        "durationMs": Double(durationMs),
        "capturedAt": nowMs(),
      ])
    }
  }

  /// Completes with nil once capture is running, or with an error.
  /// Failures are reported only through the completion, never also as a
  /// HearingStartError event: the JS pipeline cleans up on both, and
  /// doing both at once would run its cleanup twice.
  func start(_ completion: @escaping (HearingError?) -> Void) {
    queue.async {
      if self.isRunning {
        completion(nil) // already running: a no-op, as on Android
        return
      }
      guard HearingAudioSession.micPermissionGranted() else {
        completion(.micPermissionDenied)
        return
      }
      do {
        try HearingAudioSession.activate()
        self.vad.reset()
        self.interrupted = false
        let cap = self.makeCapture()
        try cap.start()
        self.capture = cap
      } catch {
        self.capture?.stop()
        self.capture = nil
        HearingAudioSession.deactivate()
        completion(HearingError(code: "AUDIO_INIT", message: "Could not start the microphone: \(error.localizedDescription)"))
        return
      }
      self.startedAt = nowMs()
      self.setRunning(true)
      self.addObservers()
      self.emit?("HearingSessionStarted", [
        "startedAt": self.startedAt,
        "sampleRate": HearingVAD.sampleRate,
      ])
      completion(nil)
    }
  }

  func stop(userRequested: Bool, _ completion: (() -> Void)? = nil) {
    queue.async {
      self.finish(userRequested: userRequested)
      completion?()
    }
  }

  // ─── internals (queue only) ─────────────────────────────────────

  private func makeCapture() -> AudioCapture {
    AudioCapture(
      queue: queue,
      onFrame: { [weak self] frame in self?.vad.process(frame) },
      onFailure: { [weak self] _ in self?.finish(userRequested: false) }
    )
  }

  /// Mirrors stopCapture() in HearingService.kt: an unfinished segment is
  /// discarded rather than emitted, every buffer is zeroed, and the
  /// summary goes out last.
  private func finish(userRequested: Bool) {
    guard isRunning else { return }
    setRunning(false)
    removeObservers()
    capture?.stop()
    capture = nil
    vad.discardInFlight()
    interrupted = false
    HearingAudioSession.deactivate()

    emit?("HearingSessionStopped", [
      "startedAt": startedAt,
      "endedAt": nowMs(),
      "totalMs": Double(vad.totalFrames) * Double(HearingVAD.frameMs),
      "speechMs": Double(vad.speechFrames) * Double(HearingVAD.frameMs),
      "segmentsEmitted": vad.segmentsEmitted,
      "userRequested": userRequested,
    ])
  }

  private func addObservers() {
    let nc = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers.append(nc.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: nil
    ) { [weak self] note in
      let info = note.userInfo
      self?.queue.async { self?.handleInterruption(info) }
    })
    observers.append(nc.addObserver(
      forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil
    ) { [weak self] _ in
      // The audio system restarted underneath us; every object is stale.
      self?.queue.async { self?.resume(rebuild: true) }
    })
    observers.append(nc.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
    ) { [weak self] _ in
      // An interruption can begin without iOS ever sending the matching
      // "ended" — most often while the app sat suspended. Coming back to
      // the foreground is the reliable moment to retry.
      self?.queue.async {
        guard let self = self, self.isRunning, self.interrupted else { return }
        self.resume(rebuild: false)
      }
    })
  }

  private func removeObservers() {
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
  }

  private func handleInterruption(_ info: [AnyHashable: Any]?) {
    guard isRunning,
          let raw = info?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }

    switch type {
    case .began:
      // The system has already stopped the engine. A sentence cut off by
      // a call is dropped rather than half-processed.
      interrupted = true
      capture?.stop()
      vad.discardInFlight()
    case .ended:
      // Resumed whether or not iOS sets `.shouldResume`: that hint is for
      // media playback, and the person asked for this session to run.
      // If iOS refuses, resume() ends the session cleanly.
      resume(rebuild: false)
    @unknown default:
      break
    }
  }

  private func resume(rebuild: Bool) {
    guard isRunning else { return }
    do {
      try HearingAudioSession.activate()
      if rebuild || capture == nil {
        capture?.stop()
        capture = makeCapture()
      }
      try capture?.start()
      interrupted = false
    } catch {
      // Typically: still in the background after a call, where iOS won't
      // restart recording. End the session rather than pretend to listen.
      finish(userRequested: false)
    }
  }
}
