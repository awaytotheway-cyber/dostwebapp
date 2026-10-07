package com.dost.app.listening

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Stage 1: is there any sound above the room's background?
 *
 * Tracks an adaptive noise floor in dBFS that falls quickly toward quieter
 * frames and rises slowly through steady noise. Pauses between words keep
 * pulling the floor back down, so speech stays above it while a fan that
 * runs without pauses is slowly absorbed into it.
 */
class EnergyGate {
  var floorDb: Double = ListenConfig.FLOOR_START_DB
    private set
  var lastLevelDb: Double = -96.0
    private set

  private val risePerFrame =
    ListenConfig.FLOOR_RISE_DB_PER_SEC * ListenConfig.FRAME_MS / 1000.0

  /** Returns true when the frame counts as sound. */
  fun process(frame: ShortArray, len: Int): Boolean {
    val level = levelDb(frame, len)
    lastLevelDb = level
    val loud = level > max(floorDb + ListenConfig.GATE_MARGIN_DB, ListenConfig.GATE_ABS_MIN_DB)
    floorDb = if (level < floorDb) {
      floorDb + ListenConfig.FLOOR_FALL_SHARE * (level - floorDb)
    } else {
      min(level, floorDb + risePerFrame)
    }
    return loud
  }

  fun reset() {
    floorDb = ListenConfig.FLOOR_START_DB
  }

  companion object {
    fun levelDb(frame: ShortArray, len: Int): Double {
      if (len <= 0) return -96.0
      var sum = 0.0
      for (i in 0 until len) {
        val v = frame[i] / 32768.0
        sum += v * v
      }
      val rms = sqrt(sum / len)
      return if (rms <= 1e-5) -96.0 else 20.0 * log10(rms)
    }

    fun isDigitalSilence(frame: ShortArray, len: Int): Boolean {
      for (i in 0 until len) if (frame[i].toInt() != 0) return false
      return true
    }
  }
}
