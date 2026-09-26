package dev.codewide.app.performance

import java.util.ArrayDeque
import kotlin.math.abs

internal data class TimelineScrollPoint(
  val viewTag: Int,
  val unixMs: Long,
  val uptimeMs: Long,
  val offsetPx: Int,
  val contentHeightPx: Int,
  val viewportHeightPx: Int,
)

internal data class TimelineScrollIncident(
  val previous: TimelineScrollPoint,
  val current: TimelineScrollPoint,
  val source: String,
  val stack: List<String>,
)

/** Detects discontinuities, not bugs: an intentional scroll command may also appear here. */
internal class TimelineScrollIncidents(private val capacity: Int = 12) {
  private val previousByView = LinkedHashMap<Int, TimelineScrollPoint>()
  private val incidents = ArrayDeque<TimelineScrollIncident>()
  var evicted = 0
    private set

  fun record(point: TimelineScrollPoint, captureStack: () -> Array<StackTraceElement>) {
    val previous = previousByView.put(point.viewTag, point) ?: return trimViews()
    val elapsed = point.uptimeMs - previous.uptimeMs
    if (elapsed !in 0..300 || point.viewportHeightPx <= 0 ||
      abs(point.contentHeightPx - previous.contentHeightPx) > 1 ||
      abs(point.viewportHeightPx - previous.viewportHeightPx) > 1 ||
      previous.offsetPx - point.offsetPx < point.viewportHeightPx / 2
    ) return
    val frames = captureStack()
    val source = scrollSource(frames)
    val stack = frames.asSequence().filter { allowedScrollFrame(it.className) }
      .take(32).map { "${it.className}.${it.methodName}:${it.lineNumber}" }.toList()
    if (incidents.size == capacity) {
      incidents.removeFirst()
      evicted += 1
    }
    incidents.addLast(TimelineScrollIncident(previous, point, source, stack))
  }

  fun snapshot(): List<TimelineScrollIncident> = incidents.toList()

  private fun trimViews() {
    if (previousByView.size > 16) {
      val iterator = previousByView.entries.iterator()
      iterator.next()
      iterator.remove()
    }
  }
}

private fun allowedScrollFrame(name: String): Boolean =
  name.startsWith("android.view.") || name.startsWith("android.widget.") ||
    name.startsWith("com.facebook.react.") || name.startsWith("com.swmansion.reanimated.") ||
    name.startsWith("com.reactnativekeyboardcontroller.")

private fun scrollSource(frames: Array<StackTraceElement>): String = when {
  frames.any { it.className.startsWith("com.facebook.react.") && it.methodName == "setContentOffset" } -> "content-offset-prop"
  frames.any { it.className.contains("MaintainVisibleScrollPositionHelper") } -> "visible-content-adjustment"
  frames.any { it.className.startsWith("com.reactnativekeyboardcontroller.") } -> "keyboard"
  frames.any { it.className.startsWith("com.swmansion.reanimated.") } -> "worklet-scroll"
  frames.any { it.className.endsWith("ReactScrollViewManager") && it.methodName == "scrollTo" } -> "scroll-command"
  frames.any { it.className.endsWith("ReactScrollView") && it.methodName in setOf("onLayout", "onLayoutChange") } -> "layout-clamp"
  frames.any { it.methodName in setOf("computeScroll", "onOverScrolled", "fling") } -> "native-motion"
  else -> "unknown"
}
