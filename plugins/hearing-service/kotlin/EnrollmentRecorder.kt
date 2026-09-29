package com.dost.app.hearing

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/**
 * One-shot short-duration PCM capture for speaker enrollment.
 *
 * Runs in the foreground app (no service, no persistent notification,
 * no wake lock), fills an in-memory ShortArray for the requested
 * duration, and hands it back to JS as base64. The buffer is zeroed
 * before release, keeping Phase 1's "no audio on disk" rule intact —
 * nothing about enrollment ever touches the filesystem.
 *
 * AudioRecord is configured identically to HearingService (16 kHz
 * mono PCM16) so an enrolled voiceprint matches what the runtime
 * session pipeline will produce during real listening.
 */
class EnrollmentRecorder(private val ctx: ReactApplicationContext) {
  companion object {
    const val SAMPLE_RATE = 16000
    const val MIN_DURATION_MS = 2000
    const val MAX_DURATION_MS = 20_000

    private const val TAG = "EnrollmentRecorder"
  }

  private var recorder: AudioRecord? = null
  private var captureThread: Thread? = null

  @Volatile
  private var shouldRun: Boolean = false

  fun capture(durationMs: Int, promise: Promise) {
    if (shouldRun) {
      promise.reject(
        "ENROLLMENT_BUSY",
        "An enrollment capture is already in progress",
      )
      return
    }
    if (
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("MIC_PERMISSION", "Microphone permission not granted")
      return
    }

    val clampedMs = durationMs.coerceIn(MIN_DURATION_MS, MAX_DURATION_MS)
    val totalSamples = SAMPLE_RATE * clampedMs / 1000

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufSize = maxOf(minBuf, SAMPLE_RATE * 2)

    val rec = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize,
      )
    } catch (e: SecurityException) {
      promise.reject("MIC_PERMISSION", "AudioRecord denied: ${e.message}")
      return
    }

    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      promise.reject("AUDIO_INIT", "AudioRecord failed to initialize")
      return
    }

    recorder = rec
    shouldRun = true

    captureThread = thread(start = true, name = "EnrollmentCapture") {
      val buffer = ShortArray(totalSamples)
      var written = 0
      try {
        rec.startRecording()
        val chunk = ShortArray(1024)
        while (shouldRun && written < totalSamples) {
          val toRead = minOf(chunk.size, totalSamples - written)
          val read = rec.read(chunk, 0, toRead)
          if (read <= 0) continue
          System.arraycopy(chunk, 0, buffer, written, read)
          written += read
        }
        try { rec.stop() } catch (_: Throwable) {}
        rec.release()
        recorder = null

        // Pack short samples as little-endian bytes, base64.
        val bytes = ByteArray(written * 2)
        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until written) bb.putShort(buffer[i])
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)

        // Zero the source before releasing.
        for (i in 0 until written) buffer[i] = 0

        val result = Arguments.createMap().apply {
          putString("pcmBase64", b64)
          putInt("sampleRate", SAMPLE_RATE)
          putDouble("durationMs", (written * 1000L / SAMPLE_RATE).toDouble())
        }
        promise.resolve(result)
      } catch (e: Throwable) {
        try { rec.stop() } catch (_: Throwable) {}
        rec.release()
        recorder = null
        // Zero any partially-filled buffer before promise rejects out.
        for (i in 0 until written) buffer[i] = 0
        promise.reject("CAPTURE_ERROR", e.message ?: "capture failed")
      } finally {
        shouldRun = false
      }
    }
  }

  fun cancel() {
    shouldRun = false
    captureThread?.let {
      try { it.join(300) } catch (_: InterruptedException) {}
    }
    captureThread = null
    recorder?.let {
      try { it.stop() } catch (_: Throwable) {}
      it.release()
    }
    recorder = null
  }
}
