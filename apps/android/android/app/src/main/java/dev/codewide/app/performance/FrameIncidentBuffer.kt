package dev.codewide.app.performance

import java.util.ArrayDeque
import kotlin.math.ceil

internal data class FrameObservation(
  val startedAtUnixMs: Long,
  val finishedAtUnixMs: Long,
  val durationNanos: Long,
  val deadlineNanos: Long,
  val intervalNanos: Long,
  val layoutNanos: Long = 0,
  val drawNanos: Long = 0,
  val gpuNanos: Long = 0,
  val uiDelayNanos: Long = 0,
  val droppedReports: Int = 0,
)

/** Primitive aggregates only: no frame payloads, stacks, views, or user content. */
internal class FrameIncidentBuffer(private val capacity: Int = 120, private val includeHealthy: Boolean = false) {
  private val pending = ArrayDeque<Map<String, Double>>()
  private var droppedWindows = 0
  private var firstAtMs = Long.MAX_VALUE
  private var lastAtMs = 0L
  private var frames = 0
  private var jank = 0
  private var missedVsyncEstimate = 0
  private var droppedReports = 0
  private var jankNanos = 0L
  private var overrunNanos = 0L
  private var maxFrameNanos = 0L
  private var maxOverrunNanos = 0L
  private var maxLayoutNanos = 0L
  private var maxDrawNanos = 0L
  private var maxGpuNanos = 0L
  private var maxUiDelayNanos = 0L

  init { require(capacity > 0) }

  @Synchronized
  fun record(frame: FrameObservation) {
    droppedReports += frame.droppedReports.coerceAtLeast(0)
    if (frame.durationNanos <= 0) return
    val interval = frame.intervalNanos.coerceAtLeast(1)
    val deadline = frame.deadlineNanos.takeIf { it > 0 } ?: interval
    firstAtMs = minOf(firstAtMs, frame.startedAtUnixMs)
    lastAtMs = maxOf(lastAtMs, frame.finishedAtUnixMs)
    frames += 1
    maxFrameNanos = maxOf(maxFrameNanos, frame.durationNanos)
    maxLayoutNanos = maxOf(maxLayoutNanos, frame.layoutNanos)
    maxDrawNanos = maxOf(maxDrawNanos, frame.drawNanos)
    maxGpuNanos = maxOf(maxGpuNanos, frame.gpuNanos)
    maxUiDelayNanos = maxOf(maxUiDelayNanos, frame.uiDelayNanos)
    if (frame.durationNanos > deadline) {
      jank += 1
      jankNanos += frame.durationNanos
      val overrun = frame.durationNanos - deadline
      overrunNanos += overrun
      maxOverrunNanos = maxOf(maxOverrunNanos, overrun)
    }
    missedVsyncEstimate += (ceil(frame.durationNanos.toDouble() / interval).toInt() - 1).coerceAtLeast(0)
  }

  @Synchronized
  fun flush() {
    if (frames > 0 && (includeHealthy || jank > 0 || droppedReports > 0)) {
      if (pending.size == capacity) {
        pending.removeFirst()
        droppedWindows += 1
      }
      pending.addLast(mapOf(
        "windowStartUnixMs" to firstAtMs.toDouble(),
        "windowEndUnixMs" to lastAtMs.toDouble(),
        "frameCount" to frames.toDouble(),
        "jankFrameCount" to jank.toDouble(),
        "missedVsyncEstimate" to missedVsyncEstimate.toDouble(),
        "droppedMetricReports" to droppedReports.toDouble(),
        "jankFrameTotalMs" to jankNanos / 1_000_000.0,
        "overrunTotalMs" to overrunNanos / 1_000_000.0,
        "maxFrameMs" to maxFrameNanos / 1_000_000.0,
        "maxOverrunMs" to maxOverrunNanos / 1_000_000.0,
        "maxLayoutMs" to maxLayoutNanos / 1_000_000.0,
        "maxDrawMs" to maxDrawNanos / 1_000_000.0,
        "maxGpuMs" to maxGpuNanos / 1_000_000.0,
        "maxUiDelayMs" to maxUiDelayNanos / 1_000_000.0,
      ))
    }
    firstAtMs = Long.MAX_VALUE
    lastAtMs = 0
    frames = 0
    jank = 0
    missedVsyncEstimate = 0
    droppedReports = 0
    jankNanos = 0
    overrunNanos = 0
    maxFrameNanos = 0
    maxOverrunNanos = 0
    maxLayoutNanos = 0
    maxDrawNanos = 0
    maxGpuNanos = 0
    maxUiDelayNanos = 0
  }

  @Synchronized
  fun drain(): Pair<List<Map<String, Double>>, Int> {
    val result = pending.toList() to droppedWindows
    pending.clear()
    droppedWindows = 0
    return result
  }
}
