package com.dost.app.hearing

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS bridge for scheduling listening session alarms.
 *
 * JS calls:
 *   ScheduleModule.setAlarm(scheduleId, triggerAtMillis)
 *   ScheduleModule.cancelAlarm(scheduleId)
 *   ScheduleModule.cancelAllAlarms()
 */
class ScheduleModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "HearingScheduleModule"

    private fun prefs(): SharedPreferences =
        reactApplicationContext.getSharedPreferences(
            BootReceiver.PREFS_NAME, Context.MODE_PRIVATE
        )

    @ReactMethod
    fun setAlarm(scheduleId: Int, triggerAtMillis: Double, promise: Promise) {
        try {
            val triggerAt = triggerAtMillis.toLong()
            if (triggerAt <= System.currentTimeMillis()) {
                promise.reject("INVALID_TIME", "Trigger time must be in the future")
                return
            }
            ScheduleReceiver.setAlarm(reactApplicationContext, scheduleId, triggerAt)
            prefs().edit().putLong("schedule_$scheduleId", triggerAt).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cancelAlarm(scheduleId: Int, promise: Promise) {
        try {
            ScheduleReceiver.cancelAlarm(reactApplicationContext, scheduleId)
            prefs().edit().remove("schedule_$scheduleId").apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cancelAllAlarms(promise: Promise) {
        try {
            val p = prefs()
            val editor = p.edit()
            for ((key, _) in p.all) {
                if (!key.startsWith("schedule_")) continue
                val scheduleId = key.removePrefix("schedule_").toIntOrNull() ?: continue
                ScheduleReceiver.cancelAlarm(reactApplicationContext, scheduleId)
                editor.remove(key)
            }
            editor.apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
