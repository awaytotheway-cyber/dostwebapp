package com.dost.app.hearing

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Fires when a scheduled listening session alarm triggers.
 *
 * Emits a JS event so the React Native layer can show a notification
 * and let the user decide whether to start a session. This receiver
 * NEVER starts the microphone service directly — the user must
 * explicitly confirm.
 */
class ScheduleReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_ALARM = "com.dost.app.hearing.SCHEDULE_ALARM"
        const val EXTRA_SCHEDULE_ID = "schedule_id"

        fun setAlarm(
            context: Context,
            scheduleId: Int,
            triggerAtMillis: Long
        ) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, ScheduleReceiver::class.java).apply {
                action = ACTION_ALARM
                putExtra(EXTRA_SCHEDULE_ID, scheduleId)
            }
            val pi = PendingIntent.getBroadcast(
                context, scheduleId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        }

        fun cancelAlarm(context: Context, scheduleId: Int) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, ScheduleReceiver::class.java).apply {
                action = ACTION_ALARM
                putExtra(EXTRA_SCHEDULE_ID, scheduleId)
            }
            val pi = PendingIntent.getBroadcast(
                context, scheduleId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.cancel(pi)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ALARM) return
        val scheduleId = intent.getIntExtra(EXTRA_SCHEDULE_ID, -1)
        if (scheduleId < 0) return

        // Emit JS event. The React Native layer handles the notification
        // and user confirmation. We never start the mic from here.
        try {
            val reactContext = HearingService.reactContext
            reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("HearingScheduleAlarm", scheduleId)
        } catch (_: Exception) {
            // App may not be running — the notification will be shown
            // when the app next opens if the schedule is still active.
        }
    }
}
