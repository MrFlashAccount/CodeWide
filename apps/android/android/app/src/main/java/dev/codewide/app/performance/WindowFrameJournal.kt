package dev.codewide.app.performance

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Called only by the collector executor, never from a frame, scroll, or main-thread callback. */
internal class WindowFrameJournal(directory: File, private val reports: WindowFrameReports) {
  private val file = AtomicFile(File(directory, "window-frame-report-v1.json"))
  private var persistedRevision = -1L

  fun restore() {
    runCatching {
      if (file.baseFile.length() > 1_048_576) return
      val root = JSONObject(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
      if (root.optInt("version") != 1) return
      val windows = root.optJSONArray("windows") ?: return
      for (index in 0 until minOf(windows.length(), 600)) {
        val raw = windows.optJSONObject(index) ?: continue
        val values = mutableMapOf<String, Double>()
        for (field in FRAME_REPORT_FIELDS) values[field] = raw.optDouble(field, Double.NaN)
        reports.append(WindowFrameReport(raw.optString("surface"), raw.optString("activity"), values, raw.optInt("appBuild", -1)), publish = false)
      }
    }
    persistedRevision = reports.snapshot().revision
  }

  fun persist() {
    val snapshot = reports.snapshot()
    if (snapshot.revision == persistedRevision) return
    runCatching {
      val output = file.startWrite()
      try {
        output.write(encode(snapshot).toByteArray(Charsets.UTF_8))
        file.finishWrite(output)
        persistedRevision = snapshot.revision
      } catch (error: Exception) {
        file.failWrite(output)
        throw error
      }
    }
  }

  fun export(): String = encode(reports.snapshot())

  private fun encode(snapshot: WindowFrameReports.Snapshot): String = JSONObject().apply {
    put("version", 1)
    put("capacity", 600)
    put("evictedWindows", snapshot.evictedWindows)
    put("unobservedWindows", snapshot.unobservedWindows)
    put("scrollAttribution", "native_scroll_with_50ms_lead_250ms_tail")
    put("windows", JSONArray().apply {
      for (report in snapshot.windows) put(JSONObject().apply {
        put("surface", report.surface)
        put("activity", report.activity)
        put("appBuild", report.appBuild)
        for ((key, value) in report.values) put(key, value)
      })
    })
  }.toString()
}
