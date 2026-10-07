package com.dost.app.listening

/**
 * Fixed-size circular buffer of the most recent PCM samples (RAM only).
 * Used for pre-roll: when a clip opens, the half second before it is
 * copied out of here so first words are not clipped.
 */
class PcmRing(capacitySamples: Int) {
  private val buf = ShortArray(capacitySamples)
  private var write = 0
  private var filled = 0

  fun push(frame: ShortArray, len: Int) {
    for (i in 0 until len) {
      buf[write] = frame[i]
      write = (write + 1) % buf.size
    }
    filled = minOf(buf.size, filled + len)
  }

  /** Copies the last [count] samples (or fewer, if not yet filled). */
  fun last(count: Int): ShortArray {
    val n = minOf(count, filled)
    val out = ShortArray(n)
    var start = write - n
    if (start < 0) start += buf.size
    for (i in 0 until n) out[i] = buf[(start + i) % buf.size]
    return out
  }

  /** Overwrites the contents with zeros. */
  fun wipe() {
    buf.fill(0)
    write = 0
    filled = 0
  }
}
