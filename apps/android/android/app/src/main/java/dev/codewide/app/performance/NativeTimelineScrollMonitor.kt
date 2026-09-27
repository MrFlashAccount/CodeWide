package dev.codewide.app.performance

import android.os.SystemClock
import android.view.FrameMetrics
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.views.scroll.ReactScrollViewHelper
import com.facebook.react.views.scroll.ScrollEventType

/** Main-thread geometry and frame-thread timings; only the bounded trace crosses between threads. */
internal class NativeTimelineScrollMonitor : ReactScrollViewHelper.ScrollListener {
  private val incidents = TimelineScrollIncidents()
  private val trace = TimelineScrollTrace()
  private val views = LinkedHashMap<ViewGroup, TimelineViewObservation>()
  private var listening = false
  private var density = 0f

  fun start() {
    if (listening) return
    listening = true
    ReactScrollViewHelper.addScrollListener(this)
  }

  fun stop() {
    if (!listening) return
    listening = false
    ReactScrollViewHelper.removeScrollListener(this)
    for (observer in views.values) observer.close()
    views.clear()
  }

  override fun onScroll(scrollView: ViewGroup?, scrollEventType: ScrollEventType?, xVelocity: Float, yVelocity: Float) {
    val phase = when (scrollEventType) {
      ScrollEventType.SCROLL -> TimelineGeometryPhase.SCROLL
      ScrollEventType.BEGIN_DRAG -> TimelineGeometryPhase.DRAG_START
      ScrollEventType.END_DRAG -> TimelineGeometryPhase.DRAG_END
      ScrollEventType.MOMENTUM_BEGIN -> TimelineGeometryPhase.MOMENTUM_START
      ScrollEventType.MOMENTUM_END -> TimelineGeometryPhase.MOMENTUM_END
      else -> return
    }
    observe(scrollView)?.sample(phase)
  }

  override fun onLayout(scrollView: ViewGroup?) {
    observe(scrollView)?.sample(TimelineGeometryPhase.LAYOUT)
  }

  private fun observe(view: ViewGroup?): TimelineViewObservation? {
    if (!listening || view == null || view.getTag(com.facebook.react.R.id.react_test_id) != "conversation-timeline") return null
    density = view.resources.displayMetrics.density
    views[view]?.let { return it }
    if (views.size == 4) {
      val oldest = views.entries.iterator()
      oldest.next().value.close()
      oldest.remove()
    }
    return TimelineViewObservation(view, ::recordGeometry) { views.remove(view) }.also { views[view] = it }
  }

  private fun recordGeometry(event: TimelineTraceEvent.Geometry) {
    val incident = event.phase == TimelineGeometryPhase.SCROLL && incidents.record(TimelineScrollPoint(
      event.viewTag, event.unixMs, event.uptimeMs, event.offsetPx, event.contentHeightPx, event.viewportHeightPx,
    )) { Thread.currentThread().stackTrace }
    trace.geometry(event, incident)
  }

  /** Uses the already attached Activity FrameMetrics listener; independent of HUD and Hermes profiling. */
  fun recordFrame(metrics: FrameMetrics, dropped: Int, intervalNanos: Long) {
    val uptime = SystemClock.uptimeMillis()
    if (!trace.needsFrame(uptime)) return
    val now = System.nanoTime()
    val started = metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP).takeIf { it > 0 } ?: now
    fun millis(metric: Int) = metrics.getMetric(metric).takeIf { it >= 0 }?.div(1_000_000.0) ?: -1.0
    trace.frame(TimelineTraceEvent.Frame(
      System.currentTimeMillis() - (now - started).coerceAtLeast(0) / 1_000_000, uptime,
      millis(FrameMetrics.TOTAL_DURATION),
      (metrics.getMetric(FrameMetrics.DEADLINE).takeIf { it > 0 } ?: intervalNanos) / 1_000_000.0,
      millis(FrameMetrics.LAYOUT_MEASURE_DURATION), millis(FrameMetrics.DRAW_DURATION),
      millis(FrameMetrics.GPU_DURATION), millis(FrameMetrics.UNKNOWN_DELAY_DURATION), dropped.coerceAtLeast(0),
    ))
  }

  fun report(): WritableMap = Arguments.createMap().apply {
    putInt("version", 2)
    putInt("appBuild", dev.codewide.app.BuildConfig.VERSION_CODE)
    putString("appVersion", dev.codewide.app.BuildConfig.VERSION_NAME)
    putDouble("density", density.toDouble())
    putBoolean("listening", listening)
    putInt("trackedViews", views.size)
    putMap("trace", encodeTimelineTrace(trace.snapshot()))
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
