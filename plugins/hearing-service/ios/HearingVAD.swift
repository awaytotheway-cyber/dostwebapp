/// Per-frame voice-activity detector and segmenter for listening sessions.
///
/// A line-for-line port of `processFrame` and its helpers in
/// `plugins/hearing-service/kotlin/HearingService.kt`. The two platforms
/// must cut speech into the same segments from the same audio, because
/// everything downstream (speaker gate, transcription, emotion tags,
/// session summaries) is shared JavaScript that assumes one behaviour.
/// If you change a constant or a branch here, change it there too.
///
/// Swift standard library only, deliberately: no Foundation, no
/// AVFoundation, no React. That keeps it compilable and testable on Linux
/// against the real Android code (see ../ios-tests/), where the rest of
/// the iOS module cannot be built.
///
/// Privacy rules carried over from Android:
///   - Audio lives only in memory. The segment buffer and the pre-roll
///     ring are zeroed after every use, and on `reset()`.
///   - A finished segment is lent to `onSegment` as a buffer pointer that
///     is valid only for that call; the storage is zeroed immediately
///     afterwards, so no copy outlives the callback unless the caller
///     makes one (and zeroes it).
final class HearingVAD {
  // ─── constants: identical to HearingService.kt ──────────────────
  static let sampleRate = 16_000
  static let frameMs = 20
  static let frameSamples = sampleRate * frameMs / 1000 // 320
  static let ringSeconds = 30
  static let ringSize = sampleRate * ringSeconds
  static let minSegmentMs = 1_500
  static let silenceHangoverMs = 800

  static let vadAggressiveness = 2
  static let vadAbsoluteMinRms = 0.006

  static let noiseFloorCalibrationMs = 500
  static let noiseFloorMultiplier = 2.5

  static let vadMinSpeechFramesBase = 2

  static let preRollMs = 300
  static let preRollFrames = preRollMs / frameMs // 15

  static let tickEveryFrames: Int64 = 25 // ~500 ms

  struct Tick {
    let speech: Bool
    let rms: Double
    let noiseFloor: Double
    let calibrating: Bool
    let totalMs: Double
    let speechMs: Double
  }

  /// Called every ~500 ms for the UI's live dot.
  var onTick: ((Tick) -> Void)?
  /// Called with a finished segment of at least `minSegmentMs`. The
  /// pointer is only valid during the call.
  var onSegment: ((UnsafeBufferPointer<Int16>, Int) -> Void)?

  private(set) var totalFrames: Int64 = 0
  private(set) var speechFrames: Int64 = 0
  private(set) var segmentsEmitted: Int = 0

  private var preRoll = [Int16](repeating: 0, count: HearingVAD.preRollFrames * HearingVAD.frameSamples)
  private var preRollCount = 0
  private var preRollHead = 0

  // Allocated once and reused; Android allocates per segment. Same
  // contents either way, without a 960 KB allocation per utterance.
  private var segment = [Int16](repeating: 0, count: HearingVAD.ringSize)
  private var segmentLength = 0
  private var segmentOpen = false
  private var silenceMs = 0
  private var speechFramesInRow = 0
  private var inSpeech = false

  private var noiseFloorRms = 0.0
  private var noiseFloorFrames = 0
  private var noiseFloorCalibrated = false
  private let calibrationFramesTarget = HearingVAD.noiseFloorCalibrationMs / HearingVAD.frameMs

  var noiseFloor: Double { noiseFloorRms }
  var isCalibrated: Bool { noiseFloorCalibrated }

  /// Start-of-session state. Zeroes every buffer.
  func reset() {
    totalFrames = 0
    speechFrames = 0
    segmentsEmitted = 0
    noiseFloorRms = 0
    noiseFloorFrames = 0
    noiseFloorCalibrated = false
    discardInFlight()
  }

  /// Drop an unfinished segment without emitting it, zeroing everything.
  /// Mirrors the buffer cleanup in `stopCapture()`.
  func discardInFlight() {
    zero(&segment, count: segmentLength)
    segmentLength = 0
    segmentOpen = false
    silenceMs = 0
    speechFramesInRow = 0
    inSpeech = false
    clearPreRoll()
  }

  /// Feed one frame of 16 kHz mono PCM16. Frames are normally exactly
  /// `frameSamples` long; a shorter final frame is handled as on Android.
  func process(_ frame: UnsafeBufferPointer<Int16>) {
    let len = frame.count
    guard len > 0 else { return }
    totalFrames += 1

    var sumSq = 0.0
    for i in 0..<len {
      let v = Double(frame[i]) / 32768.0
      sumSq += v * v
    }
    let rms = (sumSq / Double(len)).squareRoot()

    // Adaptive noise floor: the first ~500 ms seeds it as a mean; after
    // that, silent frames slowly nudge it toward the current ambient level.
    if !noiseFloorCalibrated {
      noiseFloorRms += rms
      noiseFloorFrames += 1
      if noiseFloorFrames >= calibrationFramesTarget {
        noiseFloorRms /= Double(noiseFloorFrames)
        noiseFloorCalibrated = true
      }
      // VAD is skipped entirely during calibration.
      maybeEmitTick(speech: false, rms: rms)
      return
    }

    let threshold = max(HearingVAD.vadAbsoluteMinRms, noiseFloorRms * HearingVAD.noiseFloorMultiplier)
    let isSpeech = rms >= threshold
    let onsetFrames = HearingVAD.vadMinSpeechFramesBase + HearingVAD.vadAggressiveness

    if isSpeech {
      speechFrames += 1
      speechFramesInRow += 1
      silenceMs = 0
      if !inSpeech && speechFramesInRow >= onsetFrames {
        inSpeech = true
        segmentOpen = true
        segmentLength = 0
        flushPreRollIntoSegment()
      }
      if inSpeech { appendToSegment(frame) } else { pushPreRoll(frame) }
    } else {
      speechFramesInRow = 0
      if inSpeech {
        appendToSegment(frame)
        silenceMs += HearingVAD.frameMs
        if silenceMs >= HearingVAD.silenceHangoverMs { finalizeSegment() }
      } else {
        // Track ambient drift upward slowly, biased so it can never climb
        // into the speech band.
        noiseFloorRms = (noiseFloorRms * 0.98) + (rms * 0.02)
        pushPreRoll(frame)
      }
    }

    maybeEmitTick(speech: isSpeech, rms: rms)
  }

  // ─── internals ──────────────────────────────────────────────────

  private func maybeEmitTick(speech: Bool, rms: Double) {
    guard totalFrames % HearingVAD.tickEveryFrames == 0 else { return }
    onTick?(Tick(
      speech: speech,
      rms: rms,
      noiseFloor: noiseFloorRms,
      calibrating: !noiseFloorCalibrated,
      totalMs: Double(totalFrames) * Double(HearingVAD.frameMs),
      speechMs: Double(speechFrames) * Double(HearingVAD.frameMs)
    ))
  }

  private func appendToSegment(_ frame: UnsafeBufferPointer<Int16>) {
    guard segmentOpen else { return }
    let toCopy = min(frame.count, segment.count - segmentLength)
    if toCopy <= 0 {
      // Ring full (30 s of continuous speech): cut here, as Android does.
      // The frame that didn't fit is dropped with it.
      finalizeSegment()
      return
    }
    let base = segmentLength
    segment.withUnsafeMutableBufferPointer { dst in
      for i in 0..<toCopy { dst[base + i] = frame[i] }
    }
    segmentLength = base + toCopy
  }

  private func pushPreRoll(_ frame: UnsafeBufferPointer<Int16>) {
    let off = preRollHead * HearingVAD.frameSamples
    let n = min(frame.count, HearingVAD.frameSamples)
    for i in 0..<n { preRoll[off + i] = frame[i] }
    if n < HearingVAD.frameSamples {
      for i in n..<HearingVAD.frameSamples { preRoll[off + i] = 0 }
    }
    preRollHead = (preRollHead + 1) % HearingVAD.preRollFrames
    if preRollCount < HearingVAD.preRollFrames { preRollCount += 1 }
  }

  private func flushPreRollIntoSegment() {
    let first = (preRollHead - preRollCount + HearingVAD.preRollFrames) % HearingVAD.preRollFrames
    preRoll.withUnsafeBufferPointer { ring in
      for i in 0..<preRollCount {
        let slot = (first + i) % HearingVAD.preRollFrames
        let start = slot * HearingVAD.frameSamples
        appendToSegment(UnsafeBufferPointer(rebasing: ring[start..<(start + HearingVAD.frameSamples)]))
      }
    }
    clearPreRoll()
  }

  private func clearPreRoll() {
    zero(&preRoll, count: preRoll.count)
    preRollCount = 0
    preRollHead = 0
  }

  private func finalizeSegment() {
    let len = segmentLength
    let wasOpen = segmentOpen
    // Integer division, as Kotlin's `len * 1000L / SAMPLE_RATE`.
    let durationMs = len * 1000 / HearingVAD.sampleRate

    segmentOpen = false
    segmentLength = 0
    silenceMs = 0
    inSpeech = false

    if wasOpen && durationMs >= HearingVAD.minSegmentMs {
      segment.withUnsafeBufferPointer { buf in
        onSegment?(UnsafeBufferPointer(rebasing: buf[0..<len]), durationMs)
      }
      segmentsEmitted += 1
    }
    // Emitted or too short, the buffer is zeroed either way.
    zero(&segment, count: len)
  }

  private func zero(_ a: inout [Int16], count: Int) {
    let n = min(count, a.count)
    guard n > 0 else { return }
    a.withUnsafeMutableBufferPointer { p in
      for i in 0..<n { p[i] = 0 }
    }
  }
}
