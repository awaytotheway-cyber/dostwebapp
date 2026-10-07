package com.dost.app.listening

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.StatFs
import android.util.Log
import org.json.JSONObject
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Foreground service that owns a listening session. Everything — capture,
 * gating, encoding, logging — runs here in Kotlin, so a session keeps
 * working with the app swiped away and JavaScript not running.
 *
 * Rules kept here:
 *   - The notification is always shown while the microphone is open.
 *   - One session at a time.
 *   - Never restarts itself: a session only starts from a user action
 *     (in-app button, or later a notification tap).
 *   - Every session ends with a session_end line carrying the stop reason.
 */
class ListenService : Service() {
  companion object {
    const val ACTION_START = "com.dost.app.listening.START"
    const val ACTION_STOP = "com.dost.app.listening.STOP"
    const val EXTRA_POLICY = "policy"
    const val EXTRA_TRIGGER = "trigger"
    const val EXTRA_REASON = "reason"

    private const val CHANNEL_ID = "dost.listening"
    private const val ALERT_CHANNEL_ID = "dost.listening.alerts"
    private const val NOTIFICATION_ID = 4712
    private const val STOPPED_NOTIFICATION_ID = 4713
    private const val TAG = "ListenService"

    @Volatile
    var current: ListenService? = null
      private set

    @Volatile
    var lastStopReason: String? = null
      private set

    fun startIntent(ctx: Context, policy: String, trigger: String): Intent =
      Intent(ctx, ListenService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_POLICY, policy)
        .putExtra(EXTRA_TRIGGER, trigger)

    fun stopIntent(ctx: Context, reason: String): Intent =
      Intent(ctx, ListenService::class.java)
        .setAction(ACTION_STOP)
        .putExtra(EXTRA_REASON, reason)
  }

  private val main = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var log: SessionLog? = null

  // Read from the JavaScript module thread.
  @Volatile private var pipeline: CapturePipeline? = null
  @Volatile private var stopping = false

  @Volatile
  var sessionId: String? = null
    private set

  @Volatile
  var startedAt: Long = 0
    private set

  @Volatile
  var policy: String = ListenConfig.POLICY_ANY_SOUND
    private set

  /** True from start until the session_end line is written. */
  val isActive: Boolean
    get() = pipeline != null

  fun snapshot(): Map<String, Any?> {
    val p = pipeline
    val base = mutableMapOf<String, Any?>(
      "running" to (p != null),
      "stopping" to stopping,
      "sessionId" to sessionId,
      "startedAt" to startedAt,
      "policy" to policy,
    )
    if (p != null) {
      base.putAll(p.stats())
      base["inClip"] = p.inClipNow
      base["levelDb"] = Math.round(p.levelDb * 10) / 10.0
      base["micSilenced"] = p.micSilenced
    }
    return base
  }

  override fun onCreate() {
    super.onCreate()
    current = this
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val pol = intent.getStringExtra(EXTRA_POLICY) ?: ListenConfig.POLICY_ANY_SOUND
        val trigger = intent.getStringExtra(EXTRA_TRIGGER) ?: "manual"
        if (pipeline != null) {
          // Already listening; startForegroundService still needs startForeground.
          startForegroundNow()
        } else {
          startSession(pol, trigger)
        }
      }
      ACTION_STOP -> {
        if (pipeline != null) {
          stopSession(intent.getStringExtra(EXTRA_REASON) ?: "user")
        } else {
          stopSelf()
        }
      }
      // A null intent means Android restarted the process. The microphone is
      // never reopened from the background; the log shows the old session
      // without a session_end, which reconcile treats as os_killed.
      else -> if (pipeline == null) stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun startSession(pol: String, trigger: String) {
    policy = pol
    stopping = false
    if (!startForegroundNow()) {
      lastStopReason = "fgs_not_allowed"
      stopSelf()
      return
    }
    val sid = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    sessionId = sid
    startedAt = now
    val sessionLog = SessionLog(VoicePaths.sessionLog(this))
    log = sessionLog
    sessionLog.append(
      "session_start", sid,
      mapOf("policy" to pol, "trigger" to trigger, "config" to configJson()),
    )

    val blocked = when {
      checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED -> "mic_permission"
      else -> guardReason()
    }
    if (blocked != null) {
      finishStop(blocked, null)
      return
    }

    acquireWakeLock()
    val p = CapturePipeline(this, sid, now, sessionLog) { reason ->
      main.post { if (sessionId == sid) stopSession(reason) }
    }
    pipeline = p
    p.start()
    main.postDelayed(guardTick, ListenConfig.GUARD_INTERVAL_MS)
    main.postDelayed(statsTick, ListenConfig.STATS_INTERVAL_MS)
  }

  /** Stops capture off the main thread, then writes the final log lines. */
  private fun stopSession(reason: String) {
    if (stopping) return
    stopping = true
    main.removeCallbacks(guardTick)
    main.removeCallbacks(statsTick)
    val p = pipeline
    thread(name = "ListenStop") {
      try {
        p?.stop()
      } catch (e: Exception) {
        Log.e(TAG, "stopping capture failed", e)
      }
      main.post { finishStop(reason, p) }
    }
  }

  private fun finishStop(reason: String, p: CapturePipeline?) {
    val sid = sessionId
    val sessionLog = log
    if (sid != null && sessionLog != null) {
      if (p != null) sessionLog.append("stats", sid, p.stats() + ("final" to true))
      sessionLog.append("session_end", sid, mapOf("reason" to reason))
    }
    pipeline = null
    log = null
    sessionId = null
    lastStopReason = reason
    releaseWakeLock()
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (reason != "user" && reason != "notification") postStoppedNotice(reason)
    stopping = false
    stopSelf()
  }

  override fun onDestroy() {
    main.removeCallbacks(guardTick)
    main.removeCallbacks(statsTick)
    val p = pipeline
    if (p != null && !stopping) {
      // Destroyed without a stop request: finish synchronously so the last
      // clip and the session_end line are written.
      try { p.stop() } catch (_: Exception) {}
      val sid = sessionId
      if (sid != null) {
        log?.append("stats", sid, p.stats() + ("final" to true))
        log?.append("session_end", sid, mapOf("reason" to "service_destroyed"))
      }
      lastStopReason = "service_destroyed"
      pipeline = null
    }
    releaseWakeLock()
    if (current === this) current = null
    super.onDestroy()
  }

  // ─── guards ─────────────────────────────────────────────────────

  private val guardTick = object : Runnable {
    override fun run() {
      if (pipeline == null || stopping) return
      acquireWakeLock()
      val reason = guardReason()
      if (reason != null) stopSession(reason) else main.postDelayed(this, ListenConfig.GUARD_INTERVAL_MS)
    }
  }

  private val statsTick = object : Runnable {
    override fun run() {
      val p = pipeline ?: return
      val sid = sessionId ?: return
      if (stopping) return
      log?.append("stats", sid, p.stats())
      main.postDelayed(this, ListenConfig.STATS_INTERVAL_MS)
    }
  }

  private fun guardReason(): String? {
    try {
      if (StatFs(filesDir.path).availableBytes < ListenConfig.MIN_FREE_BYTES) return "low_storage"
    } catch (_: Exception) {}
    val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    if (bm != null) {
      val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
      if (pct in 0 until ListenConfig.MIN_BATTERY_PERCENT && !bm.isCharging) return "low_battery"
    }
    return null
  }

  private fun acquireWakeLock() {
    val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DOST::Listening")
      .apply { setReferenceCounted(false) }
      .also { wakeLock = it }
    lock.acquire(ListenConfig.WAKE_LOCK_TIMEOUT_MS)
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) try { it.release() } catch (_: Exception) {} }
    wakeLock = null
  }

  // ─── notifications ──────────────────────────────────────────────

  private fun startForegroundNow(): Boolean {
    return try {
      val n = buildListeningNotification()
      // The microphone service type exists from Android 11.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, n)
      }
      true
    } catch (e: Exception) {
      Log.e(TAG, "startForeground failed", e)
      false
    }
  }

  private fun buildListeningNotification(): Notification {
    ensureChannels()
    val stop = PendingIntent.getService(
      this, 1, stopIntent(this, "notification"),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val b = builder(CHANNEL_ID)
      .setContentTitle("DOST is listening")
      .setContentText(policyText(policy))
      .setSmallIcon(statusIcon())
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setShowWhen(true)
      .setWhen(if (startedAt > 0) startedAt else System.currentTimeMillis())
      .setUsesChronometer(true)
      .addAction(Notification.Action.Builder(Icon.createWithResource(this, statusIcon()), "Stop", stop).build())
    openAppIntent()?.let { b.setContentIntent(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return b.build()
  }

  private fun postStoppedNotice(reason: String) {
    ensureChannels()
    val text = when (reason) {
      "low_storage" -> "Stopped because phone storage is almost full."
      "low_battery" -> "Stopped because the battery is low."
      "mic_unavailable" -> "Stopped because the microphone stayed unavailable."
      "mic_permission" -> "Stopped because microphone permission is off."
      else -> "Listening stopped unexpectedly."
    }
    val b = builder(ALERT_CHANNEL_ID)
      .setContentTitle("DOST stopped listening")
      .setContentText(text)
      .setSmallIcon(statusIcon())
      .setAutoCancel(true)
    openAppIntent()?.let { b.setContentIntent(it) }
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(STOPPED_NOTIFICATION_ID, b.build())
    } catch (e: SecurityException) {
      // Notifications turned off; the stop reason is still in the log.
    }
  }

  private fun policyText(pol: String): String = when (pol) {
    ListenConfig.POLICY_ANY_SOUND -> "Saving any sound — test build"
    else -> "Listening"
  }

  private fun builder(channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channel)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

  private fun statusIcon(): Int {
    val id = resources.getIdentifier("dost_listening_status", "drawable", packageName)
    return if (id != 0) id else android.R.drawable.ic_btn_speak_now
  }

  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this, 2, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
      mgr.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Listening", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown whenever DOST is listening."
          setShowBadge(false)
        },
      )
    }
    if (mgr.getNotificationChannel(ALERT_CHANNEL_ID) == null) {
      mgr.createNotificationChannel(
        NotificationChannel(ALERT_CHANNEL_ID, "Listening alerts", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "Tells you when listening stopped on its own."
        },
      )
    }
  }

  private fun configJson(): JSONObject = JSONObject().apply {
    put("sampleRate", ListenConfig.SAMPLE_RATE)
    put("frameMs", ListenConfig.FRAME_MS)
    put("preRollMs", ListenConfig.PRE_ROLL_MS)
    put("hangoverMs", ListenConfig.HANGOVER_MS)
    put("minClipMs", ListenConfig.MIN_CLIP_MS)
    put("maxClipMs", ListenConfig.MAX_CLIP_MS)
    put("startFrames", ListenConfig.START_FRAMES)
    put("gateMarginDb", ListenConfig.GATE_MARGIN_DB)
    put("gateAbsMinDb", ListenConfig.GATE_ABS_MIN_DB)
    put("floorRiseDbPerSec", ListenConfig.FLOOR_RISE_DB_PER_SEC)
    put("aacBitrate", ListenConfig.AAC_BITRATE)
  }
}
