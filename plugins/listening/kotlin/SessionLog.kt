package com.dost.app.listening

import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Append-only JSON-lines log that JavaScript reconciles later. Each line is
 * synced to disk so a killed process still leaves a readable trail.
 * Lines hold times, durations, counts and file names — never audio.
 */
class SessionLog(private val file: File) {
  @Synchronized
  fun append(type: String, sessionId: String, fields: Map<String, Any?> = emptyMap()) {
    val obj = JSONObject()
    obj.put("t", type)
    obj.put("sessionId", sessionId)
    obj.put("ts", System.currentTimeMillis())
    for ((k, v) in fields) obj.put(k, v ?: JSONObject.NULL)
    try {
      file.parentFile?.mkdirs()
      FileOutputStream(file, true).use { out ->
        out.write((obj.toString() + "\n").toByteArray(Charsets.UTF_8))
        out.fd.sync()
      }
    } catch (e: Exception) {
      Log.w("ListenLog", "append($type) failed: ${e.message}")
    }
  }
}
