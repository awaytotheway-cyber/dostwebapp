package com.dost.app.listening

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Layout of app-private voice storage (filesDir/voice/). The folder is
 * excluded from Android backup by the config plugin.
 *
 *   voice/session_log.jsonl
 *   voice/recordings/YYYY-MM-DD/seg_<session>_<startMs>.m4a
 *   voice/enrollment/           (enrollment clips and voiceprint, Step 4)
 */
object VoicePaths {
  fun root(ctx: Context): File = File(ctx.filesDir, "voice").apply { mkdirs() }

  fun sessionLog(ctx: Context): File = File(root(ctx), "session_log.jsonl")

  fun recordings(ctx: Context): File = File(root(ctx), "recordings").apply { mkdirs() }

  fun segmentFile(ctx: Context, sessionId: String, startEpochMs: Long): File {
    val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(startEpochMs))
    val dir = File(recordings(ctx), day).apply { mkdirs() }
    return File(dir, "seg_${sessionId}_$startEpochMs.m4a")
  }

  /** Path relative to voice/, as written to the session log. */
  fun relative(ctx: Context, file: File): String =
    file.absolutePath.removePrefix(root(ctx).absolutePath).trimStart('/')

  /** Outside voice/: not personal data, survives "delete all recordings". */
  fun modelCheckResult(ctx: Context): File = File(ctx.filesDir, "listening_model_check.json")
}
