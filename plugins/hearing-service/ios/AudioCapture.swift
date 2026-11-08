import AVFoundation

/// Microphone → 16 kHz mono PCM16, delivered in 20 ms frames.
///
/// The iOS counterpart of the `AudioRecord` setup in HearingService.kt
/// and EnrollmentRecorder.kt. Android asks the hardware for 16 kHz mono
/// PCM16 directly; iOS gives whatever the hardware runs at (usually
/// 48 kHz float), so this converts. Everything downstream sees the same
/// frames either way: `HearingVAD.frameSamples` Int16 samples at 16 kHz.
///
/// Threading: the tap runs on an AVFoundation thread and only converts.
/// Every frame is delivered, and every bit of state is touched, on the
/// owner's serial `queue`. `start()` and `stop()` must be called on it.
///
/// Audio is never written to disk. Intermediate buffers are zeroed once
/// they've been consumed.
final class AudioCapture {
  enum CaptureError: Error {
    case noInputDevice
    case converterUnavailable
  }

  private let engine = AVAudioEngine()
  private let queue: DispatchQueue
  private let onFrame: (UnsafeBufferPointer<Int16>) -> Void
  private let onFailure: (String) -> Void

  private let targetFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32,
    sampleRate: Double(HearingVAD.sampleRate),
    channels: 1,
    interleaved: false
  )!

  // Read on the tap thread. Replaced only while the tap is removed.
  private var converter: AVAudioConverter?

  // Queue-only state.
  private var pending = [Int16]()
  private var frameScratch = [Int16](repeating: 0, count: HearingVAD.frameSamples)
  private var configObserver: NSObjectProtocol?
  private(set) var running = false

  init(
    queue: DispatchQueue,
    onFrame: @escaping (UnsafeBufferPointer<Int16>) -> Void,
    onFailure: @escaping (String) -> Void
  ) {
    self.queue = queue
    self.onFrame = onFrame
    self.onFailure = onFailure
    // Sized once so appending never reallocates: a reallocation would
    // free the old storage, with audio still in it, without zeroing it.
    // A tap buffer is ~700 samples at 16 kHz, so this is ample headroom.
    pending.reserveCapacity(HearingVAD.frameSamples * 64)
  }

  deinit {
    if let o = configObserver { NotificationCenter.default.removeObserver(o) }
  }

  /// Install the tap and start the engine. Safe to call again after
  /// `stop()` — used to resume after an interruption.
  func start() throws {
    try installTapAndStart()
    running = true
    if configObserver == nil {
      // Route changes (headphones in or out, the mic switching) stop the
      // engine and may change the input format, so the tap is rebuilt.
      configObserver = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange,
        object: engine,
        queue: nil
      ) { [weak self] _ in
        guard let self = self else { return }
        self.queue.async { self.handleConfigurationChange() }
      }
    }
  }

  func stop() {
    if let o = configObserver {
      NotificationCenter.default.removeObserver(o)
      configObserver = nil
    }
    guard running else { return }
    running = false
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    zeroPending()
  }

  // ─── internals ──────────────────────────────────────────────────

  private func installTapAndStart() throws {
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }

    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
      throw CaptureError.noInputDevice
    }
    guard let conv = AVAudioConverter(from: inFormat, to: targetFormat) else {
      throw CaptureError.converterUnavailable
    }
    converter = conv

    input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buffer, _ in
      self?.convertAndDeliver(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
  }

  private func handleConfigurationChange() {
    guard running else { return }
    zeroPending()
    do {
      try installTapAndStart()
    } catch {
      running = false
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      onFailure("audio-route-changed")
    }
  }

  /// Tap thread: resample/downmix to 16 kHz mono, quantise to Int16 the
  /// way AudioRecord's PCM16 would, then hand off to the queue.
  private func convertAndDeliver(_ buffer: AVAudioPCMBuffer) {
    guard let conv = converter, buffer.frameLength > 0 else { return }
    let ratio = targetFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

    var supplied = false
    var error: NSError?
    let status = conv.convert(to: out, error: &error) { _, inputStatus in
      if supplied {
        // .noDataNow (not .endOfStream) keeps the converter primed for
        // the next tap buffer, so resampling stays continuous.
        inputStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, error == nil, let channel = out.floatChannelData?[0] else { return }

    let n = Int(out.frameLength)
    guard n > 0 else { return }
    // A manually managed buffer rather than an Array: Swift arrays are
    // copy-on-write, so "zeroing" one can zero a fresh copy and leave the
    // original audio in memory. This one is zeroed and freed exactly once.
    let samples = UnsafeMutableBufferPointer<Int16>.allocate(capacity: n)
    for i in 0..<n {
      let x = max(-1.0, min(1.0, channel[i]))
      samples[i] = Int16((x * 32767.0).rounded())
      channel[i] = 0 // zero the float copy as we go
    }

    queue.async { [weak self] in
      self?.ingest(UnsafeBufferPointer(samples))
      for i in 0..<samples.count { samples[i] = 0 }
      samples.deallocate()
    }
  }

  /// Queue: cut the stream into exact 20 ms frames.
  private func ingest(_ samples: UnsafeBufferPointer<Int16>) {
    guard running else { return }
    pending.append(contentsOf: samples)
    let fs = HearingVAD.frameSamples
    // The frame is copied out of `pending` before the callback runs, so a
    // callback that stops capture can't touch an array still being read.
    while running && pending.count >= fs {
      for i in 0..<fs {
        frameScratch[i] = pending[i]
        pending[i] = 0
      }
      pending.removeFirst(fs)
      frameScratch.withUnsafeBufferPointer { onFrame($0) }
    }
    for i in 0..<frameScratch.count { frameScratch[i] = 0 }
  }

  private func zeroPending() {
    for i in 0..<pending.count { pending[i] = 0 }
    pending.removeAll(keepingCapacity: true)
  }
}
