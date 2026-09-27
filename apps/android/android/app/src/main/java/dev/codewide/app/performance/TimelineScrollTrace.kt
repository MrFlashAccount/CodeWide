package dev.codewide.app.performance

import java.util.ArrayDeque

internal enum class TimelineGeometryPhase(val wireName: String) {
  ATTACH("attach"), DETACH("detach"), DRAW("draw"), LAYOUT("layout"), SCROLL("scroll"),
  DRAG_START("drag-start"), DRAG_END("drag-end"), MOMENTUM_START("momentum-start"), MOMENTUM_END("momentum-end"),
}

/** Content-free observations; frame completion and view geometry have different authorities. */
internal sealed interface TimelineTraceEvent {
  val unixMs: Long
  val uptimeMs: Long

  data class Geometry(
    override val unixMs: Long,
    override val uptimeMs: Long,
    val viewTag: Int,
    val phase: TimelineGeometryPhase,
    val offsetPx: Int,
    val contentHeightPx: Int,
    val viewportHeightPx: Int,
    val contentChildren: Int,
    val shown: Boolean,
    val alpha: Float,
    val contentAlpha: Float,
    val imeBottomPx: Int,
  ) : TimelineTraceEvent

  data class Frame(
    override val unixMs: Long,
    override val uptimeMs: Long,
    val durationMs: Double,
    val deadlineMs: Double,
    val layoutMs: Double,
    val drawMs: Double,
    val gpuMs: Double,
    val uiDelayMs: Double,
    val droppedReports: Int,
  ) : TimelineTraceEvent
}

internal data class TimelineTraceEntry(val sequence: Long, val event: TimelineTraceEvent)
internal data class TimelineTraceCapture(val triggerSequence: Long, val entries: List<TimelineTraceEntry>)
internal data class TimelineTraceSnapshot(
  val evicted: Long,
  val evictedCaptures: Int,
  val geometryCount: Long,
  val frameCount: Long,
  val drawCount: Long,
  val entries: List<TimelineTraceEntry>,
  val captures: List<TimelineTraceCapture>,
)

/** Bounded native flight recorder, shared by the main and FrameMetrics threads. No bridge traffic. */
internal class TimelineScrollTrace(
  private val capacity: Int = 240,
  private val beforeCount: Int = 64,
  private val afterCount: Int = 96,
  private val captureCapacity: Int = 4,
) {
  private data class Capture(val trigger: Long, val entries: MutableList<TimelineTraceEntry>, var remaining: Int)
  private val entries = ArrayDeque<TimelineTraceEntry>()
  private val captures = ArrayDeque<Capture>()
  private var sequence = 0L
  private var evicted = 0L
  private var evictedCaptures = 0
  private var geometryCount = 0L
  private var frameCount = 0L
  private var drawCount = 0L
  private var lastGeometryUptimeMs = Long.MIN_VALUE

  init { require(capacity > 0 && beforeCount in 1..capacity && afterCount > 0 && captureCapacity > 0) }

  @Synchronized
  fun geometry(event: TimelineTraceEvent.Geometry, incident: Boolean) {
    lastGeometryUptimeMs = event.uptimeMs
    geometryCount++
    if (event.phase == TimelineGeometryPhase.DRAW) drawCount++
    append(event)
    if (incident) {
      // A burst is one causal window, not four mostly identical copies. Never extend it unboundedly.
      val pending = captures.peekLast()
      if (pending == null || pending.remaining == 0) {
        if (captures.size == captureCapacity) { captures.removeFirst(); evictedCaptures++ }
        val before = mutableListOf<TimelineTraceEntry>()
        var skip = (entries.size - beforeCount).coerceAtLeast(0)
        for (entry in entries) { if (skip-- <= 0) before.add(entry) }
        captures.addLast(Capture(sequence, before, afterCount))
      }
    }
  }

  @Synchronized
  fun needsFrame(uptimeMs: Long): Boolean =
    lastGeometryUptimeMs != Long.MIN_VALUE && uptimeMs - lastGeometryUptimeMs in 0..2_000

  @Synchronized
  fun frame(event: TimelineTraceEvent.Frame) {
    if (!needsFrame(event.uptimeMs)) return
    frameCount++
    append(event)
  }

  private fun append(event: TimelineTraceEvent) {
    val entry = TimelineTraceEntry(++sequence, event)
    if (entries.size == capacity) { entries.removeFirst(); evicted++ }
    entries.addLast(entry)
    for (capture in captures) {
      if (capture.remaining > 0) { capture.entries.add(entry); capture.remaining-- }
    }
  }

  /** Copies isolate this export from subsequent callbacks on both recorder threads. */
  @Synchronized
  fun snapshot() = TimelineTraceSnapshot(
    evicted, evictedCaptures, geometryCount, frameCount, drawCount,
    entries.toList(), captures.map { TimelineTraceCapture(it.trigger, it.entries.toList()) },
  )
}
