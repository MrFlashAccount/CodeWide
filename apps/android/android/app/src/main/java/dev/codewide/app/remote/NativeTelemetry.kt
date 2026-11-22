package dev.codewide.app.remote

import android.os.SystemClock
import com.facebook.react.bridge.ReactMarker
import com.facebook.react.bridge.ReactMarkerConstants
import org.json.JSONObject

internal data class NativeTelemetryMetric(
  val name: String,
  val values: Map<String, Number> = emptyMap(),
  val tags: Map<String, String> = emptyMap(),
)

internal fun interface NativeTelemetryRecorder {
  fun record(metric: NativeTelemetryMetric)

  companion object {
    val NONE = NativeTelemetryRecorder { }
  }
}

internal fun NativeTelemetryMetric.toJson(): String {
  val valuesJson = JSONObject()
  values.forEach(valuesJson::put)
  val tagsJson = JSONObject()
  tags.forEach(tagsJson::put)
  return JSONObject()
    .put("name", name)
    .put("values", valuesJson)
    .put("tags", tagsJson)
    .toString()
}

internal fun elapsedMilliseconds(startedAtNanos: Long): Double =
  (SystemClock.elapsedRealtimeNanos() - startedAtNanos) / 1_000_000.0

internal data class NativeStartupTiming(
  val applicationOnCreateMs: Double,
  val applicationEntryToContentMs: Double,
  val activityToContentMs: Double,
  val applicationReadyToContentMs: Double,
  val applicationEntryToFirstFrameMs: Double?,
)

/** Retains cold-start timings until a connection can forward them. */
internal object NativeStartupTrace {
  private val applicationEntryAtNanos = SystemClock.elapsedRealtimeNanos()
  private var applicationStartedAtNanos = applicationEntryAtNanos
  private var applicationReadyAtNanos = applicationEntryAtNanos
  private var activityStartedAtNanos: Long? = null
  private var contentAppearedAtNanos: Long? = null
  private var markerRegistered = false
  private var firstFrameCommittedAtNanos: Long? = null

  @Synchronized
  fun markApplicationStarted() {
    applicationStartedAtNanos = SystemClock.elapsedRealtimeNanos()
  }

  @Synchronized
  fun markApplicationReady() {
    applicationReadyAtNanos = SystemClock.elapsedRealtimeNanos()
  }

  @Synchronized
  fun markActivityStarted() {
    if (activityStartedAtNanos == null) activityStartedAtNanos = SystemClock.elapsedRealtimeNanos()
  }

  @Synchronized
  fun registerContentMarker() {
    if (markerRegistered) return
    markerRegistered = true
    ReactMarker.addListener { name, _, _ ->
      if (name != ReactMarkerConstants.CONTENT_APPEARED) return@addListener
      val timing = markContentAppeared() ?: return@addListener
      CodexConnectionService.instance?.publishStartupTiming(timing)
    }
  }

  @Synchronized
  fun snapshot(): NativeStartupTiming? {
    val contentAt = contentAppearedAtNanos ?: return null
    return timing(contentAt)
  }

  fun markFirstFrameCommitted() {
    val timing = synchronized(this) {
      if (firstFrameCommittedAtNanos != null) return
      firstFrameCommittedAtNanos = SystemClock.elapsedRealtimeNanos()
      val contentAt = contentAppearedAtNanos ?: return
      timing(contentAt)
    }
    CodexConnectionService.instance?.publishStartupTiming(timing)
  }

  @Synchronized
  private fun markContentAppeared(): NativeStartupTiming? {
    if (contentAppearedAtNanos != null) return null
    val contentAt = SystemClock.elapsedRealtimeNanos()
    contentAppearedAtNanos = contentAt
    return timing(contentAt)
  }

  private fun timing(contentAtNanos: Long): NativeStartupTiming {
    val activityAt = activityStartedAtNanos ?: applicationStartedAtNanos
    return NativeStartupTiming(
      applicationOnCreateMs = durationMilliseconds(applicationStartedAtNanos, applicationReadyAtNanos),
      applicationEntryToContentMs = durationMilliseconds(applicationEntryAtNanos, contentAtNanos),
      activityToContentMs = durationMilliseconds(activityAt, contentAtNanos),
      applicationReadyToContentMs = durationMilliseconds(applicationReadyAtNanos, contentAtNanos),
      applicationEntryToFirstFrameMs = firstFrameCommittedAtNanos?.let { durationMilliseconds(applicationEntryAtNanos, it) },
    )
  }

  private fun durationMilliseconds(startedAtNanos: Long, finishedAtNanos: Long): Double =
    maxOf(0L, finishedAtNanos - startedAtNanos) / 1_000_000.0
}
