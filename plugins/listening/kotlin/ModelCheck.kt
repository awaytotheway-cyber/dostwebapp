package com.dost.app.listening

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import org.json.JSONObject
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

/**
 * Measures the Step 1 numbers on this phone: speech-detector time per
 * 32 ms frame, speaker-model time per 2 s window, load times and memory.
 * Uses generated test tones, not the microphone. The result is saved to
 * filesDir/listening_model_check.json (not personal data).
 */
object ModelCheck {
  fun run(ctx: Context, delayMs: Long): JSONObject {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DOST::ModelCheck")
    lock.acquire(5 * 60 * 1000L)
    try {
      if (delayMs > 0) Thread.sleep(delayMs)
      val out = JSONObject()
      out.put("ranAt", System.currentTimeMillis())
      out.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
      out.put("android", Build.VERSION.RELEASE)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) out.put("soc", Build.SOC_MODEL)
      out.put("screenOn", pm.isInteractive)
      out.put("rssMbBefore", rssMb("VmRSS"))

      val assets = ctx.assets
      val sr = ListenConfig.SAMPLE_RATE

      // ─── speech detector ─────────────────────────────────────────
      var t0 = SystemClock.elapsedRealtimeNanos()
      val vad = Vad(
        assets,
        VadModelConfig(
          sileroVadModelConfig = SileroVadModelConfig(
            model = ListenConfig.VAD_MODEL_ASSET,
            threshold = 0.5f,
            windowSize = ListenConfig.FRAME_SAMPLES,
          ),
          sampleRate = sr,
          numThreads = 1,
        ),
      )
      out.put("vadLoadMs", msSince(t0))
      val frame = tone(ListenConfig.FRAME_SAMPLES, sr)
      repeat(50) { vad.compute(frame) }
      val frames = 1000
      t0 = SystemClock.elapsedRealtimeNanos()
      repeat(frames) { vad.compute(frame) }
      out.put("vadMsPerFrame", msSince(t0) / frames)
      vad.release()

      // ─── speaker model ───────────────────────────────────────────
      val window = tone(ListenConfig.SPEAKER_WINDOW_MS * sr / 1000, sr)
      for (threads in intArrayOf(ListenConfig.SPEAKER_THREADS, 1)) {
        t0 = SystemClock.elapsedRealtimeNanos()
        val extractor = SpeakerEmbeddingExtractor(
          assets,
          SpeakerEmbeddingExtractorConfig(
            model = ListenConfig.SPEAKER_MODEL_ASSET,
            numThreads = threads,
          ),
        )
        out.put("speakerLoadMs_${threads}t", msSince(t0))
        out.put("speakerDim", extractor.dim())
        repeat(2) { embed(extractor, window, sr) }
        val runs = 10
        t0 = SystemClock.elapsedRealtimeNanos()
        repeat(runs) { embed(extractor, window, sr) }
        out.put("speakerMsPer2sWindow_${threads}t", msSince(t0) / runs)
        extractor.release()
      }

      out.put("screenOnAtEnd", pm.isInteractive)
      out.put("rssMbAfter", rssMb("VmRSS"))
      out.put("peakRssMb", rssMb("VmHWM"))
      out.put("ok", true)
      VoicePaths.modelCheckResult(ctx).writeText(out.toString())
      return out
    } finally {
      if (lock.isHeld) lock.release()
    }
  }

  fun lastResult(ctx: Context): JSONObject? {
    val f = VoicePaths.modelCheckResult(ctx)
    if (!f.exists()) return null
    return try { JSONObject(f.readText()) } catch (_: Exception) { null }
  }

  private fun embed(extractor: SpeakerEmbeddingExtractor, samples: FloatArray, sr: Int) {
    val stream = extractor.createStream()
    try {
      stream.acceptWaveform(samples, sr)
      stream.inputFinished()
      extractor.compute(stream)
    } finally {
      stream.release()
    }
  }

  /** A voice-like test signal: a 140 Hz tone with harmonics. */
  private fun tone(n: Int, sr: Int): FloatArray = FloatArray(n) { i ->
    val t = i.toDouble() / sr
    (0.2 * sin(2 * PI * 140 * t) + 0.1 * sin(2 * PI * 280 * t) + 0.05 * sin(2 * PI * 420 * t)).toFloat()
  }

  private fun msSince(startNs: Long): Double =
    (SystemClock.elapsedRealtimeNanos() - startNs) / 1_000_000.0

  private fun rssMb(field: String): Double {
    return try {
      File("/proc/self/status").readLines()
        .firstOrNull { it.startsWith("$field:") }
        ?.split(Regex("\\s+"))?.getOrNull(1)?.toDouble()?.div(1024.0) ?: -1.0
    } catch (_: Exception) {
      -1.0
    }
  }
}
