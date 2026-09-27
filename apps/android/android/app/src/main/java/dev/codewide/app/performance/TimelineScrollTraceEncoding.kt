package dev.codewide.app.performance

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/** Export only the declared numeric/closed-label trace contract, never View or FrameMetrics objects. */
internal fun encodeTimelineTrace(snapshot: TimelineTraceSnapshot): WritableMap = Arguments.createMap().apply {
  putDouble("evicted", snapshot.evicted.toDouble())
  putInt("evictedCaptures", snapshot.evictedCaptures)
  putDouble("geometryCount", snapshot.geometryCount.toDouble())
  putDouble("frameCount", snapshot.frameCount.toDouble())
  putDouble("drawCount", snapshot.drawCount.toDouble())
  putArray("entries", encodeEntries(snapshot.entries))
  putArray("captures", Arguments.createArray().apply {
    for (capture in snapshot.captures) pushMap(Arguments.createMap().apply {
      putDouble("triggerSequence", capture.triggerSequence.toDouble())
      putArray("entries", encodeEntries(capture.entries))
    })
  })
}

private fun encodeEntries(entries: List<TimelineTraceEntry>): WritableArray = Arguments.createArray().apply {
  for (entry in entries) pushMap(Arguments.createMap().apply {
    val event = entry.event
    putDouble("sequence", entry.sequence.toDouble())
    putDouble("unixMs", event.unixMs.toDouble())
    putDouble("uptimeMs", event.uptimeMs.toDouble())
    when (event) {
      is TimelineTraceEvent.Geometry -> {
        putString("kind", "geometry")
        putInt("viewTag", event.viewTag)
        putString("phase", event.phase.wireName)
        putInt("offsetPx", event.offsetPx)
        putInt("contentHeightPx", event.contentHeightPx)
        putInt("viewportHeightPx", event.viewportHeightPx)
        putInt("contentChildren", event.contentChildren)
        putBoolean("shown", event.shown)
        putDouble("alpha", event.alpha.toDouble())
        putDouble("contentAlpha", event.contentAlpha.toDouble())
        putInt("imeBottomPx", event.imeBottomPx)
      }
      is TimelineTraceEvent.Frame -> {
        putString("kind", "frame")
        putDouble("durationMs", event.durationMs)
        putDouble("deadlineMs", event.deadlineMs)
        putDouble("layoutMs", event.layoutMs)
        putDouble("drawMs", event.drawMs)
        putDouble("gpuMs", event.gpuMs)
        putDouble("uiDelayMs", event.uiDelayMs)
        putInt("droppedReports", event.droppedReports)
      }
    }
  })
}
