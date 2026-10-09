package dev.codewide.app.diagnostics

import android.util.Log
import org.json.JSONObject

/** Complete application-owned native logs share the crash-safe outbox, never a logcat ring buffer. */
internal object NativeAppLogger {
  fun debug(tag: String, message: String) { write("debug", Log.DEBUG, tag, message, null) }
  fun info(tag: String, message: String) { write("info", Log.INFO, tag, message, null) }
  fun warn(tag: String, message: String, error: Throwable? = null, connectionId: String? = null) { write("warn", Log.WARN, tag, message, error, connectionId) }
  fun error(tag: String, message: String, error: Throwable) { write("error", Log.ERROR, tag, message, error) }

  private fun write(level: String, priority: Int, tag: String, message: String, error: Throwable?, connectionId: String? = null) {
    val err = error?.let { JSONObject().put("name", it.javaClass.name).put("message", it.message.orEmpty()).put("stack", it.stackTraceToString()) }
    try {
      NativeDiagnosticRuntime.append(
        JSONObject().put("source", "jvm").put("event", "android.log.$tag").put("level", level)
          .put("occurredAtUnixMs", System.currentTimeMillis()).put("message", message)
          .put("err", err ?: JSONObject.NULL).put("fields", JSONObject().put("tag", tag).apply { connectionId?.let { put("connectionId", it) } }),
      )
    } catch (_: Exception) { NativeDiagnosticRuntime.recordCaptureFailure() }
    Log.println(priority, tag, NativeDiagnosticRuntime.privateText(message + (error?.let { "\n${it.stackTraceToString()}" } ?: "")))
  }
}
