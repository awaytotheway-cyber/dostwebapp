package com.dost.app.listening

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Microphone → RAM → ClipAssembler (stage 1 gate, clips) → AAC files.
 *
 * Two threads, so encoding or disk writes can never stall the microphone:
 *   capture thread    reads 32 ms frames from AudioRecord (urgent audio priority)
 *   processing thread runs ClipAssembler and the encoder
 * Frames move between them through a fixed pool; if processing falls behind,
 * frames are dropped and counted rather than blocking capture.
 */
class CapturePipeline(
  private val ctx: Context,
  private val sessionId: String,
  sessionStartEpochMs: Long,
  private val log: SessionLog,
  private val onFatal: (reason: String) -> Unit,
) {
  private class Frame(val data: ShortArray) {
    var len = 0
    var epochMs = 0L
  }

  private val sr = ListenConfig.SAMPLE_RATE
  private val frameSamples = ListenConfig.FRAME_SAMPLES

  private val pool = ArrayBlockingQueue<Frame>(ListenConfig.QUEUE_FRAMES)
  private val filled = ArrayBlockingQueue<Frame>(ListenConfig.QUEUE_FRAMES + 1)
  private val endMarker = Frame(ShortArray(0))

  private val assembler = ClipAssembler(sessionStartEpochMs, object : ClipOutput {
    override fun open(startEpochMs: Long): ClipWriter =
      AacSegmentWriter(VoicePaths.segmentFile(ctx, sessionId, startEpochMs))

    override fun saved(writer: ClipWriter, startEpochMs: Long, sizeBytes: Long) {
      val file = (writer as AacSegmentWriter).file
      log.append(
        "segment_saved", sessionId,
        mapOf(
          "file" to file.name,
          "path" to VoicePaths.relative(ctx, file),
          "startTs" to startEpochMs,
          "sessionOffsetMs" to startEpochMs - sessionStartEpochMs,
          "durationMs" to writer.durationMs,
          "sizeBytes" to sizeBytes,
          "speakerLabel" to "n/a",
          "speakerScoreMean" to null,
          "vadProbMean" to null,
        ),
      )
    }

    override fun event(type: String, fields: Map<String, Any?>) {
      if (type == "writer_error") Log.e(TAG, "writer error: ${fields["message"]}")
      log.append(type, sessionId, fields)
    }
  })

  @Volatile private var running = false
  private var captureThread: Thread? = null
  private var processThread: Thread? = null

  @Volatile var queueDroppedFrames = 0L; private set
  @Volatile var captureGapSamples = 0L; private set
  @Volatile var captureErrors = 0; private set

  val inClipNow: Boolean get() = assembler.inClipNow
  val levelDb: Double get() = assembler.levelDb
  val micSilenced: Boolean get() = assembler.micSilenced

  fun start() {
    if (running) return
    running = true
    repeat(ListenConfig.QUEUE_FRAMES) { pool.offer(Frame(ShortArray(frameSamples))) }
    processThread = thread(name = "ListenProcess") { processLoop() }
    captureThread = thread(name = "ListenCapture") { captureLoop() }
  }

  /** Stops both threads; the clip in progress is kept if it is long enough. */
  fun stop() {
    if (!running) return
    running = false
    captureThread?.join(2_000)
    captureThread = null
    // The capture thread sends the end marker on exit; this covers a thread
    // that did not exit in time.
    filled.offer(endMarker)
    processThread?.join(10_000)
    processThread = null
    assembler.wipe()
    for (f in pool) f.data.fill(0)
    pool.clear()
    filled.clear()
  }

  fun stats(): Map<String, Any?> {
    val a = assembler
    val listened = ms(a.listenedSamples)
    val saved = ms(a.savedSamples)
    val tooShort = ms(a.tooShortSamples)
    val silenced = ms(a.silencedSamples)
    return mapOf(
      "listenedMs" to listened,
      "speechMsSaved" to saved,
      "silenceDroppedMs" to maxOf(0L, listened - saved - tooShort - silenced),
      "nonspeechDroppedMs" to 0L,
      "otherDroppedMs" to 0L,
      "ambiguousDroppedMs" to 0L,
      "tooShortDroppedMs" to tooShort,
      "micSilencedMs" to silenced,
      "segmentsSaved" to a.segmentsSaved,
      "queueDroppedFrames" to queueDroppedFrames,
      "captureGapMs" to ms(captureGapSamples),
      "captureErrors" to captureErrors,
      "writerErrors" to a.writerErrors,
      "noiseFloorDb" to Math.round(a.floorDb * 10) / 10.0,
    )
  }

  private fun ms(samples: Long): Long = samples * 1000L / sr

  // ─── capture thread ─────────────────────────────────────────────

  private fun captureLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    var attempt = 0
    val scratch = Frame(ShortArray(frameSamples))
    try {
      while (running) {
        val rec = openRecorder()
        if (rec == null) {
          if (!backoff(attempt++)) {
            onFatal("mic_unavailable")
            break
          }
          continue
        }
        val bufferSamples = rec.bufferSizeInFrames.toLong()
        val startNs = SystemClock.elapsedRealtimeNanos()
        val gapBase = captureGapSamples
        var readSince = 0L
        while (running) {
          val frame = pool.poll() ?: scratch
          val n = rec.read(frame.data, 0, frameSamples)
          if (n < 0) {
            captureErrors++
            log.append("capture_error", sessionId, mapOf("code" to n, "attempt" to attempt))
            if (frame !== scratch) pool.offer(frame)
            break
          }
          if (n == 0) {
            if (frame !== scratch) pool.offer(frame)
            continue
          }
          attempt = 0
          readSince += n
          frame.len = n
          frame.epochMs = System.currentTimeMillis()
          if (frame === scratch || !filled.offer(frame)) {
            queueDroppedFrames++
            if (frame !== scratch) pool.offer(frame)
          }
          // Audio Android captured but we never read (buffer overrun).
          val expected = (SystemClock.elapsedRealtimeNanos() - startNs) * sr / 1_000_000_000L
          val lost = expected - readSince - bufferSamples
          if (lost > 0) captureGapSamples = gapBase + lost
        }
        try { rec.stop() } catch (_: Exception) {}
        rec.release()
        if (running && !backoff(attempt++)) {
          onFatal("mic_unavailable")
          break
        }
      }
    } catch (e: SecurityException) {
      Log.w(TAG, "microphone permission lost", e)
      onFatal("mic_permission")
    } catch (e: Exception) {
      Log.e(TAG, "capture failed", e)
      onFatal("error")
    } finally {
      scratch.data.fill(0)
      filled.offer(endMarker)
    }
  }

  private fun openRecorder(): AudioRecord? {
    val minBuf = AudioRecord.getMinBufferSize(
      sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBuf <= 0) return null
    // One second of headroom so short stalls never lose audio.
    val bytes = maxOf(minBuf, sr * 2)
    val rec = AudioRecord(
      MediaRecorder.AudioSource.MIC, sr,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bytes,
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return null
    }
    try {
      rec.startRecording()
    } catch (e: IllegalStateException) {
      rec.release()
      return null
    }
    if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      rec.release()
      return null
    }
    return rec
  }

  /** Sleeps before the next attempt; false when attempts are used up. */
  private fun backoff(attempt: Int): Boolean {
    val delays = ListenConfig.RETRY_DELAYS_MS
    if (attempt >= delays.size) return false
    val until = SystemClock.elapsedRealtime() + delays[attempt]
    while (running && SystemClock.elapsedRealtime() < until) Thread.sleep(100)
    return running
  }

  // ─── processing thread ──────────────────────────────────────────

  private fun processLoop() {
    try {
      while (true) {
        val f = filled.poll(1, TimeUnit.SECONDS) ?: if (running) continue else break
        if (f === endMarker) break
        assembler.process(f.data, f.len, f.epochMs)
        f.data.fill(0, 0, f.len)
        pool.offer(f)
      }
    } catch (e: InterruptedException) {
      // stopping
    } catch (e: Exception) {
      Log.e(TAG, "processing failed", e)
      onFatal("error")
    } finally {
      try {
        assembler.closeClip()
      } catch (e: Exception) {
        Log.e(TAG, "closing last clip failed", e)
      }
    }
  }

  companion object {
    private const val TAG = "ListenCapture"
  }
}
