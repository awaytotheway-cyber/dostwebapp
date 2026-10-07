package com.dost.app.listening

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * JavaScript controls for listening. JavaScript only starts, stops and
 * reads status; it never sees audio.
 *
 *   ListenModule.start(policy)      → "started" | "already_running"
 *   ListenModule.stop()             → true
 *   ListenModule.getStatus()        → live counters of the running session
 *   ListenModule.runModelCheck(ms)  → speed/memory numbers (after a delay)
 *   ListenModule.getModelCheck()    → last saved model-check result or null
 */
class ListenModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ListenModule"

  @ReactMethod
  fun start(policy: String, promise: Promise) {
    val ctx = reactApplicationContext
    if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      // startForegroundService without a working startForeground crashes the
      // app, so never start the service without the permission.
      promise.reject("MIC_PERMISSION", "Microphone permission is not granted")
      return
    }
    if (ListenService.current?.isActive == true) {
      promise.resolve("already_running")
      return
    }
    try {
      val intent = ListenService.startIntent(ctx, policy, "manual")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve("started")
    } catch (e: Exception) {
      promise.reject("LISTEN_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      if (ListenService.current?.isActive == true) {
        val ctx = reactApplicationContext
        ctx.startService(ListenService.stopIntent(ctx, "user"))
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("LISTEN_STOP_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = ListenService.current?.snapshot() ?: mapOf("running" to false)
    val out = toWritable(map)
    out.putString("lastStopReason", ListenService.lastStopReason)
    promise.resolve(out)
  }

  @ReactMethod
  fun runModelCheck(delayMs: Double, promise: Promise) {
    val ctx = reactApplicationContext
    thread(name = "ListenModelCheck") {
      try {
        promise.resolve(toWritable(ModelCheck.run(ctx, delayMs.toLong())))
      } catch (e: Throwable) {
        promise.reject("MODEL_CHECK_FAILED", e.message ?: e.javaClass.simpleName, e)
      }
    }
  }

  @ReactMethod
  fun getModelCheck(promise: Promise) {
    val last = ModelCheck.lastResult(reactApplicationContext)
    promise.resolve(last?.let { toWritable(it) })
  }

  private fun toWritable(json: JSONObject): WritableMap {
    val map = mutableMapOf<String, Any?>()
    for (key in json.keys()) map[key] = json.opt(key)
    return toWritable(map)
  }

  private fun toWritable(map: Map<String, Any?>): WritableMap {
    val out = Arguments.createMap()
    for ((k, v) in map) {
      when (v) {
        null, JSONObject.NULL -> out.putNull(k)
        is Boolean -> out.putBoolean(k, v)
        is Int -> out.putInt(k, v)
        is Long -> out.putDouble(k, v.toDouble())
        is Number -> out.putDouble(k, v.toDouble())
        is String -> out.putString(k, v)
        else -> out.putString(k, v.toString())
      }
    }
    return out
  }
}
