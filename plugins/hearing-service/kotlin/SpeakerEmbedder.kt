package com.dost.app.hearing

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors

/**
 * Neural speaker embedding (WeSpeaker ResNet34, 256-dim) via ONNX Runtime.
 *
 * The JS side computes the 80-bin Kaldi filterbank (lib/hearing/fbank.ts)
 * and hands it over as base64 little-endian float32, frames × 80. This
 * class only runs the network, so feature extraction stays in one tested
 * place. The model file is downloaded by JS into the app's document
 * directory; nothing here touches audio or writes to disk.
 *
 * Inference runs on a dedicated single thread so a ~100 ms forward pass
 * never blocks the shared native-modules queue.
 */
class SpeakerEmbedder {
  companion object {
    const val FEATURE_DIM = 80
  }

  private val executor = Executors.newSingleThreadExecutor()
  private var env: OrtEnvironment? = null
  private var session: OrtSession? = null
  private var loadedPath: String? = null

  fun embed(modelPath: String, featuresBase64: String, frames: Int, promise: Promise) {
    executor.execute {
      try {
        if (frames <= 0) {
          promise.reject("EMBED_INPUT", "No feature frames")
          return@execute
        }
        val sess = sessionFor(modelPath)
        val bytes = Base64.decode(featuresBase64, Base64.NO_WRAP)
        val expected = frames * FEATURE_DIM * 4
        if (bytes.size != expected) {
          promise.reject("EMBED_INPUT", "Expected $expected bytes, got ${bytes.size}")
          return@execute
        }
        val floats = FloatArray(frames * FEATURE_DIM)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(floats)

        val ortEnv = env!!
        val shape = longArrayOf(1L, frames.toLong(), FEATURE_DIM.toLong())
        OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(floats), shape).use { input ->
          val inputName = sess.inputNames.iterator().next()
          sess.run(mapOf(inputName to input)).use { result ->
            @Suppress("UNCHECKED_CAST")
            val out = (result.get(0).value as Array<FloatArray>)[0]
            val arr = Arguments.createArray()
            for (v in out) arr.pushDouble(v.toDouble())
            promise.resolve(arr)
          }
        }
      } catch (e: Throwable) {
        promise.reject("EMBED_ERROR", e.message ?: "embedding failed", e)
      }
    }
  }

  fun release() {
    executor.execute {
      try { session?.close() } catch (_: Throwable) {}
      session = null
      loadedPath = null
    }
  }

  private fun sessionFor(modelPath: String): OrtSession {
    val path = modelPath.removePrefix("file://")
    val current = session
    if (current != null && loadedPath == path) return current
    try { current?.close() } catch (_: Throwable) {}
    val ortEnv = env ?: OrtEnvironment.getEnvironment().also { env = it }
    val opts = OrtSession.SessionOptions().apply {
      setIntraOpNumThreads(2)
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }
    val created = ortEnv.createSession(path, opts)
    session = created
    loadedPath = path
    return created
  }
}
