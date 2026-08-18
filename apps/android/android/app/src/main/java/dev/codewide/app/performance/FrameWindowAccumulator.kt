package dev.codewide.app.performance

import kotlin.math.ceil

data class FrameWindowSnapshot(
  val renderedFrames: Int,
  val renderedFps: Double,
  val averageFrameMs: Double,
  val p95FrameMs: Double,
  val maxFrameMs: Double,
  val jankFrames: Int,
  val jankPercent: Double,
  val droppedFrameEstimate: Int,
  val averageOverrunMs: Double,
)

/**
 * Cheap per-frame accumulator. Android's frame callback only copies primitive
 * values here; sorting and projection happen once per sampling interval.
 */
class FrameWindowAccumulator {
  private val frameDurationsNanos = ArrayList<Long>(144)
  private var frameDurationSumNanos = 0L
  private var maxFrameDurationNanos = 0L
  private var overrunSumNanos = 0L
  private var jankFrames = 0
  private var droppedFrameEstimate = 0

  @Synchronized
  fun record(totalDurationNanos: Long, deadlineNanos: Long, displayIntervalNanos: Long) {
    if (totalDurationNanos <= 0L) return
    val safeDisplayInterval = displayIntervalNanos.coerceAtLeast(1L)
    val safeDeadline = deadlineNanos.takeIf { it > 0L } ?: safeDisplayInterval
    frameDurationsNanos += totalDurationNanos
    frameDurationSumNanos += totalDurationNanos
    maxFrameDurationNanos = maxOf(maxFrameDurationNanos, totalDurationNanos)
    if (totalDurationNanos > safeDeadline) {
      jankFrames += 1
      overrunSumNanos += totalDurationNanos - safeDeadline
    }
    droppedFrameEstimate += (ceil(totalDurationNanos.toDouble() / safeDisplayInterval).toInt() - 1).coerceAtLeast(0)
  }

  @Synchronized
  fun drain(elapsedMs: Long): FrameWindowSnapshot {
    val count = frameDurationsNanos.size
    if (count == 0) return emptySnapshot()
    val sorted = frameDurationsNanos.sorted()
    val p95Index = ceil(count * 0.95).toInt().coerceIn(1, count) - 1
    val elapsedSeconds = elapsedMs.coerceAtLeast(1L) / 1_000.0
    val result = FrameWindowSnapshot(
      renderedFrames = count,
      renderedFps = count / elapsedSeconds,
      averageFrameMs = nanosToMs(frameDurationSumNanos.toDouble() / count),
      p95FrameMs = nanosToMs(sorted[p95Index].toDouble()),
      maxFrameMs = nanosToMs(maxFrameDurationNanos.toDouble()),
      jankFrames = jankFrames,
      jankPercent = jankFrames * 100.0 / count,
      droppedFrameEstimate = droppedFrameEstimate,
      averageOverrunMs = if (jankFrames == 0) 0.0 else nanosToMs(overrunSumNanos.toDouble() / jankFrames),
    )
    frameDurationsNanos.clear()
    frameDurationSumNanos = 0L
    maxFrameDurationNanos = 0L
    overrunSumNanos = 0L
    jankFrames = 0
    droppedFrameEstimate = 0
    return result
  }

  @Synchronized
  fun reset() {
    frameDurationsNanos.clear()
    frameDurationSumNanos = 0L
    maxFrameDurationNanos = 0L
    overrunSumNanos = 0L
    jankFrames = 0
    droppedFrameEstimate = 0
  }

  private fun emptySnapshot() = FrameWindowSnapshot(
    renderedFrames = 0,
    renderedFps = 0.0,
    averageFrameMs = 0.0,
    p95FrameMs = 0.0,
    maxFrameMs = 0.0,
    jankFrames = 0,
    jankPercent = 0.0,
    droppedFrameEstimate = 0,
    averageOverrunMs = 0.0,
  )

  private fun nanosToMs(value: Double): Double = value / 1_000_000.0
}
