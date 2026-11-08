import AVFoundation

/// An error the JS side can act on: `code` matches what the Android
/// module rejects with, so lib/hearing/* needs no iOS-specific handling.
struct HearingError: Error {
  let code: String
  let message: String

  static let micPermissionDenied = HearingError(
    code: "MIC_PERMISSION",
    message: "Microphone permission not granted"
  )
}

/// Audio-session setup shared by listening sessions and enrollment.
enum HearingAudioSession {
  /// Configure and activate the shared audio session for capture.
  ///
  /// - `.playAndRecord` with `.mixWithOthers`: listening must not stop the
  ///   person's music or podcast, the way Android's capture doesn't.
  /// - `.measurement`: turns off the system's automatic gain control and
  ///   voice processing. That matches Android's VOICE_RECOGNITION source,
  ///   and matters because loudness is one of the measured features —
  ///   automatic levelling would flatten exactly what is being measured.
  /// - No Bluetooth input: recording over Bluetooth drops headphones into
  ///   call-quality mode for everything they play. The phone's own mic is
  ///   used instead, and playback stays on the headphones.
  /// - `.defaultToSpeaker`: without it, `.playAndRecord` routes the app's
  ///   own sound to the earpiece.
  static func activate() throws {
    let s = AVAudioSession.sharedInstance()
    try s.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
    // A hint only; the hardware may keep its own rate and AudioCapture
    // resamples either way.
    try? s.setPreferredSampleRate(Double(HearingVAD.sampleRate))
    try s.setActive(true)
  }

  static func deactivate() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  static func micPermissionGranted() -> Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    }
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  /// Shows the system prompt the first time; afterwards it reports the
  /// stored answer without prompting.
  static func requestMicPermission(_ completion: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission { granted in completion(granted) }
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission { granted in completion(granted) }
    }
  }
}
