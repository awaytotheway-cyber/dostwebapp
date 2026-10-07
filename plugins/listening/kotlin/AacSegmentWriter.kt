package com.dost.app.listening

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteOrder

/**
 * Stage 4: encodes one clip of 16 kHz mono PCM to AAC-LC in an .m4a file.
 *
 * Writes to "<name>.part" and renames on finish(), so a clip cut short by a
 * killed process is recognisable as partial.
 */
class AacSegmentWriter(val file: File) : ClipWriter {
  private val partFile = File(file.path + ".part")
  private val codec: MediaCodec
  private val muxer: MediaMuxer
  private val info = MediaCodec.BufferInfo()
  private var track = -1
  private var muxerStarted = false
  private var samplesWritten = 0L
  private var closed = false

  override val durationMs: Long
    get() = samplesWritten * 1000L / ListenConfig.SAMPLE_RATE

  init {
    val format = MediaFormat.createAudioFormat(
      MediaFormat.MIMETYPE_AUDIO_AAC, ListenConfig.SAMPLE_RATE, 1,
    ).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, ListenConfig.AAC_BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
    }
    codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      file.parentFile?.mkdirs()
      muxer = MediaMuxer(partFile.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    } catch (e: Exception) {
      codec.release()
      throw e
    }
  }

  override fun write(pcm: ShortArray, offset: Int, len: Int) {
    var pos = offset
    val end = offset + len
    while (pos < end) {
      val index = codec.dequeueInputBuffer(10_000)
      if (index < 0) {
        drain(endOfStream = false)
        continue
      }
      val buf = codec.getInputBuffer(index) ?: continue
      buf.clear()
      buf.order(ByteOrder.nativeOrder())
      val n = minOf(end - pos, buf.remaining() / 2)
      buf.asShortBuffer().put(pcm, pos, n)
      codec.queueInputBuffer(index, 0, n * 2, presentationUs(), 0)
      samplesWritten += n
      pos += n
      drain(endOfStream = false)
    }
  }

  /** Flushes the encoder, closes the file and returns its final size in bytes. */
  override fun finish(): Long {
    if (closed) return file.length()
    closed = true
    var stoppedCleanly = false
    try {
      var queued = false
      for (attempt in 0 until 100) {
        val index = codec.dequeueInputBuffer(10_000)
        if (index >= 0) {
          codec.queueInputBuffer(index, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          queued = true
          break
        }
        drain(endOfStream = false)
      }
      if (queued) drain(endOfStream = true)
    } finally {
      stoppedCleanly = releaseCodecAndMuxer()
    }
    if (!stoppedCleanly) {
      partFile.delete()
      return 0
    }
    if (!partFile.renameTo(file)) throw IllegalStateException("rename failed for ${file.name}")
    return file.length()
  }

  /** Stops without keeping anything. */
  override fun abort() {
    if (closed) return
    closed = true
    releaseCodecAndMuxer()
    partFile.delete()
    file.delete()
  }

  private fun presentationUs(): Long = samplesWritten * 1_000_000L / ListenConfig.SAMPLE_RATE

  private fun drain(endOfStream: Boolean) {
    var idleTries = 0
    while (true) {
      val out = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
      when {
        out == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream || ++idleTries > 200) return
        }
        out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          if (!muxerStarted) {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxerStarted = true
          }
        }
        out >= 0 -> {
          val data = codec.getOutputBuffer(out)
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (data != null && info.size > 0 && muxerStarted) {
            data.position(info.offset)
            data.limit(info.offset + info.size)
            muxer.writeSampleData(track, data, info)
          }
          codec.releaseOutputBuffer(out, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  /** Returns true when the muxer wrote a complete file. */
  private fun releaseCodecAndMuxer(): Boolean {
    try { codec.stop() } catch (_: Exception) {}
    codec.release()
    var ok = false
    if (muxerStarted) {
      ok = try {
        muxer.stop()
        true
      } catch (_: Exception) {
        false
      }
    }
    try { muxer.release() } catch (_: Exception) {}
    return ok
  }
}
