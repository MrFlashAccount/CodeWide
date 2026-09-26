package dev.codewide.app.performance

import android.os.SystemClock
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.views.scroll.ReactScrollViewHelper
import com.facebook.react.views.scroll.ScrollEventType

/** Main-thread, content-free observation before the RN scroll event crosses the JS bridge. */
internal class NativeTimelineScrollMonitor : ReactScrollViewHelper.ScrollListener {
  private val incidents = TimelineScrollIncidents()
  private var listening = false

  fun start() {
    if (listening) return
    listening = true
    ReactScrollViewHelper.addScrollListener(this)
  }

  fun stop() {
    if (!listening) return
    listening = false
    ReactScrollViewHelper.removeScrollListener(this)
  }

  override fun onScroll(scrollView: ViewGroup?, scrollEventType: ScrollEventType?, xVelocity: Float, yVelocity: Float) {
    if (scrollView == null || scrollEventType != ScrollEventType.SCROLL ||
      scrollView.getTag(com.facebook.react.R.id.react_test_id) != "conversation-timeline"
    ) return
    val content = scrollView.getChildAt(0) ?: return
    incidents.record(TimelineScrollPoint(
      scrollView.id, System.currentTimeMillis(), SystemClock.uptimeMillis(),
      scrollView.scrollY, content.height, scrollView.height,
    )) { Thread.currentThread().stackTrace }
  }

  override fun onLayout(scrollView: ViewGroup?) = Unit

  fun report(): WritableMap = Arguments.createMap().apply {
    putInt("version", 1)
    putInt("evicted", incidents.evicted)
    putArray("incidents", Arguments.createArray().apply {
      incidents.snapshot().forEach { incident ->
        pushMap(Arguments.createMap().apply {
          putInt("viewTag", incident.current.viewTag)
          putDouble("unixMs", incident.current.unixMs.toDouble())
          putDouble("elapsedMs", (incident.current.uptimeMs - incident.previous.uptimeMs).toDouble())
          putInt("fromOffsetPx", incident.previous.offsetPx)
          putInt("toOffsetPx", incident.current.offsetPx)
          putInt("contentHeightPx", incident.current.contentHeightPx)
          putInt("viewportHeightPx", incident.current.viewportHeightPx)
          putString("source", incident.source)
          putArray("stack", Arguments.createArray().apply {
            incident.stack.forEach { pushString(it) }
          })
        })
      }
    })
  }
}
