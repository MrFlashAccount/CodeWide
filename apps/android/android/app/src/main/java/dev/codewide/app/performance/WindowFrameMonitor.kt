package dev.codewide.app.performance

import android.os.Handler
import android.view.FrameMetrics
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import android.view.inspector.WindowInspector
import androidx.compose.ui.window.DialogWindowProvider
import kotlin.math.roundToLong

/** Discovers app/Compose windows, including nested sheets, independently of React and JS health. */
internal class WindowFrameMonitor(
  private val main: Handler,
  private val frames: Handler,
  private val reports: WindowFrameReports,
) {
  private val tracked = mutableMapOf<View, TrackedWindow>()
  private var activityWindow: Window? = null
  private var running = false
  private val discover = object : Runnable {
    override fun run() {
      if (!running) return
      val roots = WindowInspector.getGlobalWindowViews()
      val iterator = tracked.iterator()
      while (iterator.hasNext()) {
        val (root, tracker) = iterator.next()
        if (!root.isAttachedToWindow || root !in roots) { tracker.close(); iterator.remove() }
      }
      // Only new roots are inspected. Existing windows do not traverse their list contents.
      for (root in roots) {
        if (tracked.size >= 16) break
        if (root in tracked) continue
        val window = if (root === activityWindow?.decorView) activityWindow else composeWindow(root)
        if (window != null) tracked[root] = TrackedWindow(window, root, root === activityWindow?.decorView)
      }
      reports.recordCoverage(roots.count { it !in tracked })
      main.removeCallbacks(this)
      main.postDelayed(this, 1_000)
    }
  }
  private val tick = object : Runnable {
    override fun run() {
      if (!running) return
      flush()
      main.postDelayed(this, 1_000)
    }
  }

  fun start(window: Window?) {
    stop()
    activityWindow = window
    running = true
    main.post(discover)
    main.postDelayed(tick, 1_000)
  }

  fun stop() {
    running = false
    main.removeCallbacks(discover)
    main.removeCallbacks(tick)
    for (tracker in tracked.values) tracker.close()
    tracked.clear()
    activityWindow = null
  }

  fun flush() {
    for (tracker in tracked.values) tracker.flush()
  }

  private inner class TrackedWindow(private val window: Window, private val root: View, isApp: Boolean) {
    private val scroll = ScrollActivityHistory()
    private val scrollingFrames = FrameIncidentBuffer(capacity = 1, includeHealthy = true)
    private val otherFrames = FrameIncidentBuffer(capacity = 1)
    private var surface = if (isApp) "app" else "sheet"
    private var marker: View? = null
    @Volatile private var intervalNanos = displayInterval()
    private val scrollListener = ViewTreeObserver.OnScrollChangedListener { scroll.record(System.nanoTime()) }
    private val focusListener = ViewTreeObserver.OnWindowFocusChangeListener {
      // Focus loss is the fast path for a newly opened dialog; polling is the fallback.
      main.removeCallbacks(discover)
      main.post(discover)
    }
    private val listener = Window.OnFrameMetricsAvailableListener { _, metrics, dropped ->
      val now = System.nanoTime()
      val started = metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP).takeIf { it > 0 } ?: now
      val startMs = System.currentTimeMillis() - (now - started).coerceAtLeast(0) / 1_000_000
      val duration = metrics.getMetric(FrameMetrics.TOTAL_DURATION)
      val frame = FrameObservation(
        startedAtUnixMs = startMs,
        finishedAtUnixMs = startMs + duration.coerceAtLeast(0) / 1_000_000,
        durationNanos = duration,
        deadlineNanos = metrics.getMetric(FrameMetrics.DEADLINE),
        intervalNanos = intervalNanos,
        layoutNanos = metrics.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION),
        drawNanos = metrics.getMetric(FrameMetrics.DRAW_DURATION),
        gpuNanos = metrics.getMetric(FrameMetrics.GPU_DURATION),
        uiDelayNanos = metrics.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION),
        droppedReports = dropped,
      )
      if (scroll.contains(started)) scrollingFrames.record(frame) else otherFrames.record(frame)
    }

    init {
      root.viewTreeObserver.addOnScrollChangedListener(scrollListener)
      root.viewTreeObserver.addOnWindowFocusChangeListener(focusListener)
      window.addOnFrameMetricsAvailableListener(listener, frames)
    }

    fun flush() {
      intervalNanos = displayInterval()
      if (surface != "app") {
        if (marker?.isAttachedToWindow != true) marker = sheetMarker(root)
        val tag = marker?.getTag(com.facebook.react.R.id.react_test_id)
        val next = if (tag is String) tag.removePrefix("performance-sheet:") else "sheet"
        if (next in FRAME_SURFACES && next != surface) {
          val previous = surface
          frames.post {
            publish(scrollingFrames, previous, "scroll")
            publish(otherFrames, previous, "other")
          }
          surface = next
        }
      }
      // Flush on the frame handler: collection continues during a blocked JS thread.
      val currentSurface = surface
      frames.post {
        publish(scrollingFrames, currentSurface, "scroll")
        publish(otherFrames, currentSurface, "other")
      }
    }

    private fun displayInterval(): Long {
      val refresh = root.display?.refreshRate?.takeIf { it > 0f } ?: 60f
      return (1_000_000_000.0 / refresh).roundToLong().coerceAtLeast(1)
    }

    fun close() {
      runCatching { window.removeOnFrameMetricsAvailableListener(listener) }
      if (root.viewTreeObserver.isAlive) {
        root.viewTreeObserver.removeOnScrollChangedListener(scrollListener)
        root.viewTreeObserver.removeOnWindowFocusChangeListener(focusListener)
      }
      flush()
    }
  }

  private fun publish(buffer: FrameIncidentBuffer, surface: String, activity: String) {
    buffer.flush()
    for (values in buffer.drain().first) reports.append(WindowFrameReport(surface, activity, values))
  }

  private fun composeWindow(root: View): Window? {
    return search(root) { view -> if (view is DialogWindowProvider) view.window else null }
  }

  private fun sheetMarker(root: View): View? = search(root) { view ->
    val tag = view.getTag(com.facebook.react.R.id.react_test_id)
    if (tag is String && tag.startsWith("performance-sheet:")) {
      val value = tag.removePrefix("performance-sheet:")
      view.takeIf { value in FRAME_SURFACES }
    } else null
  }

  /** Bound discovery work; never recursively walk an unbounded mounted list. */
  private fun <T> search(root: View, visit: (View) -> T?): T? {
    val queue = java.util.ArrayDeque<View>()
    queue.add(root)
    var inspected = 0
    while (queue.isNotEmpty() && inspected < 64) {
      val view = queue.removeFirst()
      inspected++
      val result = visit(view)
      if (result != null) return result
      if (view is ViewGroup) {
        for (index in 0 until minOf(view.childCount, 64 - inspected - queue.size)) queue.addLast(view.getChildAt(index))
      }
    }
    return null
  }
}
