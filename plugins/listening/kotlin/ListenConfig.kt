package com.dost.app.listening

/**
 * Every tunable number of the listening pipeline. Change values here only;
 * Step 9 calibration tunes them on the phone.
 */
object ListenConfig {
  // ─── audio format ────────────────────────────────────────────────
  const val SAMPLE_RATE = 16_000
  // 32 ms: the window Silero VAD needs at 16 kHz.
  const val FRAME_SAMPLES = 512
  const val FRAME_MS = FRAME_SAMPLES * 1000 / SAMPLE_RATE

  // ─── RAM buffers ─────────────────────────────────────────────────
  // Last few seconds of audio, so a clip can start before the gate opened.
  const val RING_MS = 3_000
  // Frames waiting between the capture thread and the processing thread
  // (~8 s). If processing falls this far behind, new frames are dropped
  // and counted instead of blocking the microphone.
  const val QUEUE_FRAMES = 256

  // ─── clip shaping ────────────────────────────────────────────────
  const val PRE_ROLL_MS = 500
  const val HANGOVER_MS = 700
  const val MIN_CLIP_MS = 1_000
  const val MAX_CLIP_MS = 5 * 60 * 1000
  // Consecutive loud frames needed before a clip opens.
  const val START_FRAMES = 3

  // ─── stage 1: energy gate (dBFS) ─────────────────────────────────
  // A frame is "sound" when it is this far above the room's noise floor.
  // Desktop sim (scripts/listening/sim), steady fan at -40 dBFS, speech kept:
  // 9 dB 92%, 6 dB 98%, 4.5 dB 100% (more fan clips). Quiet room: 100% at all.
  // Step 3's speech detector filters noise, so this can drop further then.
  const val GATE_MARGIN_DB = 6.0
  // Never treat anything quieter than this as sound, however quiet the room.
  const val GATE_ABS_MIN_DB = -62.0
  const val FLOOR_START_DB = -60.0
  // The floor drops quickly toward quieter frames (share of the gap per frame)
  // and rises slowly through steady noise, so speech pauses keep it low.
  const val FLOOR_FALL_SHARE = 0.25
  const val FLOOR_RISE_DB_PER_SEC = 2.0

  // ─── stage 4: writer ─────────────────────────────────────────────
  const val AAC_BITRATE = 32_000

  // ─── session guards ──────────────────────────────────────────────
  const val STATS_INTERVAL_MS = 60_000L
  const val GUARD_INTERVAL_MS = 30_000L
  const val MIN_FREE_BYTES = 200L * 1024 * 1024
  const val MIN_BATTERY_PERCENT = 15
  // Renewed on every guard tick, so a stuck process cannot hold it forever.
  const val WAKE_LOCK_TIMEOUT_MS = 10 * 60 * 1000L

  // ─── microphone taken (phone call, another app) ──────────────────
  // Android feeds digital silence to apps that lose the mic.
  const val SILENCED_AFTER_MS = 2_000
  // Retry delays after the microphone stops delivering audio.
  val RETRY_DELAYS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000, 30_000)

  // ─── model check ─────────────────────────────────────────────────
  const val VAD_MODEL_ASSET = "dost_silero_vad.onnx"
  const val SPEAKER_MODEL_ASSET = "dost_speaker_eres2net.onnx"
  const val SPEAKER_WINDOW_MS = 2_000
  const val SPEAKER_THREADS = 2

  // Recording policies (only any_sound exists until Stages 2 and 3 land).
  const val POLICY_ANY_SOUND = "any_sound"
}
