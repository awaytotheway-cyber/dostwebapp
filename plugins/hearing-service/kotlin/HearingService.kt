package com.dost.app.hearing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/**
 * Foreground service that captures 16 kHz mono PCM audio during an
 * explicit "listening session," gates it with an energy-based VAD, and
 * emits detected speech segments to the JS layer as base64-encoded PCM.
 *
 * Non-negotiable rules:
 *   - No audio is ever written to disk. All buffers are in-memory
 *     ShortArrays that get zeroed before release.
 *   - Session-based only. Started/stopped by explicit user action.
 *   - Wake lock held only for the session's lifetime.
 */
class HearingService : Service() {
  companion object {
    const val ACTION_START = "com.dost.app.hearing.START"
    const val ACTION_STOP = "com.dost.app.hearing.STOP"
    const val CHANNEL_ID = "dost.hearing"
    const val NOTIFICATION_ID = 4711

    const val SAMPLE_RATE = 16000
    const val FRAME_MS = 20
    const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1000 // 320
    const val RING_SECONDS = 30
    const val RING_SIZE = SAMPLE_RATE * RING_SECONDS
    const val MIN_SEGMENT_MS = 1500
    const val SILENCE_HANGOVER_MS = 800

    // Native VAD (energy + adaptive noise floor). Chose this over shipping
    // a WebRTC VAD JNI binding: no maintained AAR on Maven Central, and an
    // in-service energy gate already keeps silent frames off the JS bridge
    // — the whole point of native VAD for battery. Aggressiveness follows
    // WebRTC VAD's 0..3 convention: 0 permissive, 3 strict. Default 2.
    const val VAD_AGGRESSIVENESS = 2
    const val VAD_ABSOLUTE_MIN_RMS = 0.006

    // ~500 ms noise floor calibration at session start. Threshold is then
    // max(noiseFloor * multiplier, VAD_ABSOLUTE_MIN_RMS).
    const val NOISE_FLOOR_CALIBRATION_MS = 500
    const val NOISE_FLOOR_MULTIPLIER = 2.5

    // Speech onset: N speech-labeled frames in a row before entering a
    // segment. Onset stiffness scales with aggressiveness.
    const val VAD_MIN_SPEECH_FRAMES_BASE = 2

    private const val TAG = "HearingService"

    @Volatile
    var isRunning: Boolean = false
      private set

    // Set by HearingModule. Under the bridgeless New Architecture,
    // ReactNativeHost.reactInstanceManager has no live context, so the
    // service must emit through the module's own context.
    @Volatile
    private var reactContextRef: WeakReference<ReactApplicationContext>? = null

    fun attachReactContext(ctx: ReactApplicationContext) {
      reactContextRef = WeakReference(ctx)
    }

    fun detachReactContext(ctx: ReactApplicationContext) {
      if (reactContextRef?.get() === ctx) reactContextRef = null
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var recorder: AudioRecord? = null
  private var captureThread: Thread? = null

  @Volatile
  private var shouldRun: Boolean = false

  private var segmentBuffer: ShortArray? = null
  private var segmentLength: Int = 0
  private var silenceMs: Int = 0
  private var speechFramesInRow: Int = 0
  private var inSpeech: Boolean = false

  private var totalFrames: Long = 0
  private var speechFrames: Long = 0
  private var segmentsEmitted: Int = 0
  private var sessionStartMs: Long = 0

  // Adaptive noise floor: seeded from the first ~500 ms of the session,
  // then slowly tracked during silence.
  private var noiseFloorRms: Double = 0.0
  private var noiseFloorFrames: Int = 0
  private var noiseFloorCalibrated: Boolean = false
  private val calibrationFramesTarget: Int = NOISE_FLOOR_CALIBRATION_MS / FRAME_MS

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopCapture(userRequested = true)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        startForegroundWithNotification()
        startCapture()
      }
    }
    return START_STICKY
  }

  private fun startForegroundWithNotification() {
    createChannel()

    val stopIntent = Intent(this, HearingService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPending = PendingIntent.getService(
      this, 1, stopIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("DOST is listening")
      .setContentText("Tap Stop to end the session")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .addAction(android.R.drawable.ic_media_pause, "Stop", stopPending)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val ch = NotificationChannel(
      CHANNEL_ID,
      "Listening sessions",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows a notification while DOST is listening to a session."
      setShowBadge(false)
    }
    mgr.createNotificationChannel(ch)
  }

  private fun startCapture() {
    if (shouldRun) return
    shouldRun = true
    isRunning = true
    sessionStartMs = System.currentTimeMillis()
    totalFrames = 0
    speechFrames = 0
    segmentsEmitted = 0
    noiseFloorRms = 0.0
    noiseFloorFrames = 0
    noiseFloorCalibrated = false

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "DOST::HearingSession"
    ).apply {
      setReferenceCounted(false)
      acquire(60L * 60L * 1000L) // 1h ceiling — session ends earlier in practice
    }

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    val bufSize = maxOf(minBuf, FRAME_SAMPLES * 8) * 2

    try {
      recorder = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize
      )
    } catch (e: SecurityException) {
      Log.e(TAG, "AudioRecord permission denied", e)
      emitStartError("mic-permission-denied")
      cleanup()
      stopSelf()
      return
    }

    val rec = recorder
    if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
      Log.e(TAG, "AudioRecord failed to initialize")
      emitStartError("audio-record-init-failed")
      rec?.release()
      recorder = null
      cleanup()
      stopSelf()
      return
    }

    rec.startRecording()
    emitEvent("HearingSessionStarted", Arguments.createMap().apply {
      putDouble("startedAt", sessionStartMs.toDouble())
      putInt("sampleRate", SAMPLE_RATE)
    })

    captureThread = thread(start = true, name = "HearingCapture") {
      captureLoop(rec)
    }
  }

  private fun captureLoop(rec: AudioRecord) {
    val frame = ShortArray(FRAME_SAMPLES)
    while (shouldRun) {
      val read = rec.read(frame, 0, FRAME_SAMPLES)
      if (read <= 0) continue
      processFrame(frame, read)
    }
  }

  private fun processFrame(frame: ShortArray, len: Int) {
    totalFrames++
    var sumSq = 0.0
    for (i in 0 until len) {
      val v = frame[i] / 32768.0
      sumSq += v * v
    }
    val rms = kotlin.math.sqrt(sumSq / len)

    // Adaptive noise floor. First ~500ms of the session seeds it as the
    // mean RMS; afterwards, silent frames slowly nudge it toward the
    // current ambient level so a room getting louder doesn't clip speech.
    if (!noiseFloorCalibrated) {
      noiseFloorRms += rms
      noiseFloorFrames++
      if (noiseFloorFrames >= calibrationFramesTarget) {
        noiseFloorRms = noiseFloorRms / noiseFloorFrames
        noiseFloorCalibrated = true
      }
      // Skip VAD entirely during calibration.
      maybeEmitTick(false, rms)
      return
    }

    val threshold = maxOf(
      VAD_ABSOLUTE_MIN_RMS,
      noiseFloorRms * NOISE_FLOOR_MULTIPLIER
    )
    val isSpeech = rms >= threshold

    val onsetFrames = VAD_MIN_SPEECH_FRAMES_BASE + VAD_AGGRESSIVENESS

    if (isSpeech) {
      speechFrames++
      speechFramesInRow++
      silenceMs = 0
      if (!inSpeech && speechFramesInRow >= onsetFrames) {
        inSpeech = true
        segmentBuffer = ShortArray(RING_SIZE)
        segmentLength = 0
      }
      if (inSpeech) appendToSegment(frame, len)
    } else {
      speechFramesInRow = 0
      if (inSpeech) {
        appendToSegment(frame, len)
        silenceMs += FRAME_MS
        if (silenceMs >= SILENCE_HANGOVER_MS) finalizeSegment()
      } else {
        // Slowly track ambient upward drift; never let it climb into the
        // speech band by biasing the update to a small step.
        noiseFloorRms = (noiseFloorRms * 0.98) + (rms * 0.02)
      }
    }

    maybeEmitTick(isSpeech, rms)
  }

  private fun maybeEmitTick(isSpeech: Boolean, rms: Double) {
    // Light heartbeat every ~500ms for the UI dot.
    if (totalFrames % 25L == 0L) {
      emitEvent("HearingTick", Arguments.createMap().apply {
        putBoolean("speech", isSpeech)
        putDouble("rms", rms)
        putDouble("noiseFloor", noiseFloorRms)
        putBoolean("calibrating", !noiseFloorCalibrated)
        putDouble("totalMs", (totalFrames * FRAME_MS).toDouble())
        putDouble("speechMs", (speechFrames * FRAME_MS).toDouble())
      })
    }
  }

  private fun appendToSegment(frame: ShortArray, len: Int) {
    val buf = segmentBuffer ?: return
    val toCopy = minOf(len, buf.size - segmentLength)
    if (toCopy <= 0) {
      finalizeSegment()
      return
    }
    System.arraycopy(frame, 0, buf, segmentLength, toCopy)
    segmentLength += toCopy
  }

  private fun finalizeSegment() {
    val buf = segmentBuffer
    val len = segmentLength
    val durationMs = len * 1000L / SAMPLE_RATE

    segmentBuffer = null
    segmentLength = 0
    silenceMs = 0
    inSpeech = false

    if (buf != null && durationMs >= MIN_SEGMENT_MS) {
      emitSegment(buf, len, durationMs)
      segmentsEmitted++
    } else if (buf != null) {
      // Below-threshold segment: zero and drop.
      for (i in 0 until len) buf[i] = 0
    }
  }

  private fun emitSegment(buf: ShortArray, len: Int, durationMs: Long) {
    val bytes = ByteArray(len * 2)
    val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until len) bb.putShort(buf[i])
    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)

    // Zero the source buffer immediately after packing.
    for (i in 0 until len) buf[i] = 0

    val payload = Arguments.createMap().apply {
      putString("pcmBase64", b64)
      putInt("sampleRate", SAMPLE_RATE)
      putDouble("durationMs", durationMs.toDouble())
      putDouble("capturedAt", System.currentTimeMillis().toDouble())
    }
    emitEvent("HearingSpeechSegment", payload)
  }

  private fun emitEvent(name: String, payload: WritableMap) {
    val ctx = reactContextRef?.get()
    if (ctx == null || !ctx.hasActiveReactInstance()) {
      Log.w(TAG, "emitEvent($name) dropped: no active React context")
      return
    }
    try {
      ctx.emitDeviceEvent(name, payload)
    } catch (e: Throwable) {
      Log.w(TAG, "emitEvent($name) failed: ${e.message}")
    }
  }

  private fun emitStartError(reason: String) {
    emitEvent("HearingStartError", Arguments.createMap().apply {
      putString("reason", reason)
    })
  }

  private fun stopCapture(userRequested: Boolean = false) {
    if (!isRunning) return
    shouldRun = false
    isRunning = false

    captureThread?.let {
      try { it.join(500) } catch (_: InterruptedException) {}
    }
    captureThread = null

    recorder?.let {
      try { it.stop() } catch (_: IllegalStateException) {}
      it.release()
    }
    recorder = null

    // Zero any in-flight segment buffer before releasing.
    segmentBuffer?.let { for (i in it.indices) it[i] = 0 }
    segmentBuffer = null
    segmentLength = 0
    silenceMs = 0
    speechFramesInRow = 0
    inSpeech = false

    val endedAt = System.currentTimeMillis()
    val summary = Arguments.createMap().apply {
      putDouble("startedAt", sessionStartMs.toDouble())
      putDouble("endedAt", endedAt.toDouble())
      putDouble("totalMs", (totalFrames * FRAME_MS).toDouble())
      putDouble("speechMs", (speechFrames * FRAME_MS).toDouble())
      putInt("segmentsEmitted", segmentsEmitted)
      putBoolean("userRequested", userRequested)
    }
    emitEvent("HearingSessionStopped", summary)

    cleanup()
  }

  private fun cleanup() {
    wakeLock?.let {
      if (it.isHeld) {
        try { it.release() } catch (_: Throwable) {}
      }
    }
    wakeLock = null
  }

  override fun onDestroy() {
    stopCapture()
    super.onDestroy()
  }
}
