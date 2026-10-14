package com.dost.app.hearing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences

/**
 * Re-registers AlarmManager alarms after device reboot.
 *
 * CRITICAL RULE: This receiver ONLY re-registers alarms. It NEVER
 * starts the microphone service from BOOT_COMPLETED. The user must
 * always explicitly confirm before the mic activates.
 *
 * Alarm data is persisted in SharedPreferences by ScheduleModule.
 * Format: key "schedule_{id}" → triggerAtMillis as Long.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val PREFS_NAME = "dost_hearing_schedules"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        val prefs: SharedPreferences =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val editor = prefs.edit()

        for ((key, value) in prefs.all) {
            if (!key.startsWith("schedule_")) continue
            val triggerAt = (value as? Long) ?: continue
            val scheduleId = key.removePrefix("schedule_").toIntOrNull() ?: continue

            if (triggerAt <= now) {
                // Past alarm — remove it, don't fire late.
                editor.remove(key)
                continue
            }

            ScheduleReceiver.setAlarm(context, scheduleId, triggerAt)
        }

        editor.apply()
    }
}
