package dev.codewide.app.diagnostics

import android.os.Process
import org.json.JSONObject

/** Android permits an application to read its own UID's retained crash log. Other apps are excluded. */
internal object HistoricalCrashLogs {
  fun capture() {
    val process = ProcessBuilder("logcat", "-b", "crash", "-d", "-v", "threadtime", "--uid=${Process.myUid()}").start()
    try {
      val text = process.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
      check(process.waitFor() == 0) { "Android crash-log read failed" }
      if (text.isBlank() || text.lineSequence().all { it.startsWith("---------") || it.isBlank() }) return
      NativeDiagnosticRuntime.append(
        JSONObject().put("source", "logcat").put("event", "android.retained_crash_log").put("level", "fatal")
          .put("occurredAtUnixMs", System.currentTimeMillis())
          .put("err", JSONObject().put("name", "AndroidCrashLog").put("message", "Retained crash buffer for this application's UID").put("stack", text))
          .put("fields", JSONObject()),
      )
    } finally { process.destroy() }
  }
}
