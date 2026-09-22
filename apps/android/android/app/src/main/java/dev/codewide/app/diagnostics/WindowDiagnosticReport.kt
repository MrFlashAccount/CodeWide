package dev.codewide.app.diagnostics

import android.os.Build
import dev.codewide.app.BuildConfig
import org.json.JSONArray
import org.json.JSONObject

/** Owns the content-free native report format and its public device/build metadata. */
internal object WindowDiagnosticReport {
  fun encode(journal: WindowDiagnosticJournal, failedSamples: Int): String {
    val samples = JSONArray()
    journal.forEachSample { sample ->
      samples.put(JSONObject()
        .put("unixMs", sample.unixMs)
        .put("reason", sample.reason)
        .put("geometry", JSONObject(sample.geometry)))
    }
    return JSONObject()
      .put("format", "codewide-window-geometry")
      .put("version", 1)
      .put("recording", journal.enabled)
      .put("retention", "current process; last 160 samples; restart recording clears history")
      .put("droppedSamples", journal.droppedSamples)
      .put("failedSamples", failedSamples)
      .put("manufacturer", Build.MANUFACTURER)
      .put("model", Build.MODEL)
      .put("androidApi", Build.VERSION.SDK_INT)
      .put("androidRelease", Build.VERSION.RELEASE)
      .put("appVersion", BuildConfig.VERSION_NAME)
      .put("appBuild", BuildConfig.VERSION_CODE)
      .put("samples", samples)
      .toString(2)
  }
}
