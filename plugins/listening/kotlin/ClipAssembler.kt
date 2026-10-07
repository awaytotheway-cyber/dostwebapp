package com.dost.app.listening

/** Where finished clips go. AacSegmentWriter on the phone; memory in tests. */
interface ClipWriter {
  val durationMs: Long
  fun write(pcm: ShortArray, offset: Int, len: Int)
  /** Returns the stored size in bytes, or 0 if nothing usable was kept. */
  fun finish(): Long
  fun abort()
}

interface ClipOutput {
  fun open(startEpochMs: Long): ClipWriter
  fun saved(writer: ClipWriter, startEpochMs: Long, sizeBytes: Long)
  fun event(type: String, fields: Map<String, Any?> = emptyMap())
}

/**
 * Turns a stream of 32 ms frames into clips: stage 1 gate, pre-roll,
 * hangover, minimum and maximum length, and the "microphone taken" check.
 * Pure Kotlin with no Android calls, so it runs in desktop tests.
 * Runs on one thread; counters may be read from others.
 *
 * A clip is held in RAM until it reaches the minimum length; shorter
 * sounds never reach the output.
 */
class ClipAssembler(private val sessionStartEpochMs: Long, private val out: ClipOutput) {
  private val sr = ListenConfig.SAMPLE_RATE
  private val frameSamples = ListenConfig.FRAME_SAMPLES
  private val preRollSamples = ListenConfig.PRE_ROLL_MS * sr / 1000
  private val hangoverSamples = ListenConfig.HANGOVER_MS * sr / 1000
  private val minClipSamples = ListenConfig.MIN_CLIP_MS * sr / 1000
  private val maxClipSamples = ListenConfig.MAX_CLIP_MS.toLong() * sr / 1000
  private val silencedAfterSamples = ListenConfig.SILENCED_AFTER_MS * sr / 1000

  private val gate = EnergyGate()
  private val ring = PcmRing(ListenConfig.RING_MS * sr / 1000)

  private var loudRun = 0
  private var inClip = false
  private var pending = ShortArray(minClipSamples + preRollSamples + frameSamples * (ListenConfig.START_FRAMES + 1))
  private var pendingLen = 0
  private var writer: ClipWriter? = null
  private var clipSamples = 0L
  private var clipStartEpochMs = 0L
  private var quietSamples = 0
  private var zeroRunSamples = 0
  private var lastClipEndSample = 0L

  @Volatile var listenedSamples = 0L; private set
  @Volatile var savedSamples = 0L; private set
  @Volatile var tooShortSamples = 0L; private set
  @Volatile var silencedSamples = 0L; private set
  @Volatile var segmentsSaved = 0; private set
  @Volatile var writerErrors = 0; private set
  @Volatile var micSilenced = false; private set

  val inClipNow: Boolean get() = inClip
  val levelDb: Double get() = gate.lastLevelDb
  val floorDb: Double get() = gate.floorDb

  /** [epochMs] is the wall-clock time the frame finished arriving. */
  fun process(frame: ShortArray, len: Int, epochMs: Long) {
    listenedSamples += len

    if (EnergyGate.isDigitalSilence(frame, len)) {
      zeroRunSamples += len
    } else {
      zeroRunSamples = 0
      if (micSilenced) {
        micSilenced = false
        gate.reset()
        out.event("mic_resumed")
      }
    }
    if (!micSilenced && zeroRunSamples >= silencedAfterSamples) {
      micSilenced = true
      out.event("mic_silenced")
      closeClip()
      loudRun = 0
      // Audio from before the interruption must not become the next clip's pre-roll.
      ring.wipe()
    }
    if (micSilenced) {
      silencedSamples += len
      return
    }

    val loud = gate.process(frame, len)
    ring.push(frame, len)

    if (!inClip) {
      loudRun = if (loud) loudRun + 1 else 0
      if (loudRun >= ListenConfig.START_FRAMES) openClip(epochMs)
      return
    }

    appendToClip(frame, len)
    quietSamples = if (loud) 0 else quietSamples + len
    if (quietSamples >= hangoverSamples) {
      closeClip()
    } else if (clipSamples >= maxClipSamples) {
      closeClip()
      // Keep going in a fresh file; no pre-roll, the audio is continuous.
      startClip(epochMs, ShortArray(0))
    }
  }

  /** Ends the clip in progress, keeping it if it is long enough. */
  fun closeClip() {
    if (!inClip) return
    inClip = false
    lastClipEndSample = listenedSamples
    val w = writer
    writer = null
    if (w == null) {
      // Never reached the minimum length: stays out of storage.
      tooShortSamples += clipSamples
      pending.fill(0, 0, pendingLen)
      pendingLen = 0
      return
    }
    try {
      val size = w.finish()
      if (size <= 0) {
        writerErrors++
        tooShortSamples += clipSamples
        return
      }
      savedSamples += clipSamples
      segmentsSaved++
      out.saved(w, clipStartEpochMs, size)
    } catch (e: Exception) {
      writerErrors++
      tooShortSamples += clipSamples
      out.event("writer_error", mapOf("message" to (e.message ?: e.javaClass.simpleName)))
      w.abort()
    }
  }

  /** Overwrites all audio held in RAM with zeros. */
  fun wipe() {
    ring.wipe()
    pending.fill(0)
    pendingLen = 0
  }

  private fun openClip(epochMs: Long) {
    // Pre-roll plus the frames that opened the gate, but never audio that
    // already belongs to the previous clip.
    val wanted = preRollSamples + frameSamples * ListenConfig.START_FRAMES
    val available = (listenedSamples - lastClipEndSample).coerceAtMost(wanted.toLong()).toInt()
    val pre = ring.last(available)
    startClip(epochMs - pre.size * 1000L / sr, pre)
    pre.fill(0)
  }

  private fun startClip(startEpochMs: Long, pre: ShortArray) {
    inClip = true
    loudRun = 0
    quietSamples = 0
    clipStartEpochMs = startEpochMs
    clipSamples = 0
    pendingLen = 0
    writer = null
    appendToClip(pre, pre.size)
  }

  private fun appendToClip(data: ShortArray, len: Int) {
    if (len <= 0) return
    clipSamples += len
    val w = writer
    if (w != null) {
      try {
        w.write(data, 0, len)
      } catch (e: Exception) {
        failWriter(e)
      }
      return
    }
    if (pendingLen + len > pending.size) pending = pending.copyOf(pendingLen + len)
    System.arraycopy(data, 0, pending, pendingLen, len)
    pendingLen += len
    if (pendingLen >= minClipSamples) openWriter()
  }

  private fun openWriter() {
    try {
      val w = out.open(clipStartEpochMs)
      writer = w
      w.write(pending, 0, pendingLen)
    } catch (e: Exception) {
      failWriter(e)
    } finally {
      pending.fill(0, 0, pendingLen)
      pendingLen = 0
    }
  }

  private fun failWriter(e: Exception) {
    writerErrors++
    out.event("writer_error", mapOf("message" to (e.message ?: e.javaClass.simpleName)))
    writer?.abort()
    writer = null
    // Drop the rest of this clip; the next sound starts a new one.
    tooShortSamples += clipSamples
    inClip = false
    lastClipEndSample = listenedSamples
  }
}
