package com.dost.app.hearing

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS bridge for the hearing foreground service.
 *
 * JS calls:
 *   HearingModule.startSession()
 *   HearingModule.stopSession()
 *   HearingModule.isSessionActive()
 *
 * Events emitted on DeviceEventEmitter from the service:
 *   HearingSessionStarted   { startedAt, sampleRate }
 *   HearingSessionStopped   { startedAt, endedAt, totalMs, speechMs, segmentsEmitted, userRequested }
 *   HearingSpeechSegment    { pcmBase64, sampleRate, durationMs, capturedAt }
 *   HearingTick             { speech, rms, totalMs, speechMs }
 *   HearingStartError       { reason }
 */
class HearingModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "HearingModule"

  @ReactMethod
  fun startSession(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, HearingService::class.java).apply {
        action = HearingService.ACTION_START
      }
      ContextCompat.startForegroundService(ctx, intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("HEARING_START_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopSession(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, HearingService::class.java).apply {
        action = HearingService.ACTION_STOP
      }
      ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("HEARING_STOP_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun isSessionActive(promise: Promise) {
    promise.resolve(HearingService.isRunning)
  }

  // Required no-ops for the RN event-emitter contract.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
