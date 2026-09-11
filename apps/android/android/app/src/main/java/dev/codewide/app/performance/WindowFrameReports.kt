package dev.codewide.app.performance

import java.util.ArrayDeque

internal val FRAME_REPORT_FIELDS = setOf(
  "windowStartUnixMs", "windowEndUnixMs", "frameCount", "jankFrameCount",
  "missedVsyncEstimate", "droppedMetricReports", "jankFrameTotalMs", "overrunTotalMs",
  "maxFrameMs", "maxOverrunMs", "maxLayoutMs", "maxDrawMs", "maxGpuMs", "maxUiDelayMs",
)
internal val FRAME_SURFACES = setOf("app", "sheet", "projects", "folders", "ports", "skills", "settings")

internal data class WindowFrameReport(
  val surface: String,
  val activity: String,
  val values: Map<String, Double>,
  val appBuild: Int = dev.codewide.app.BuildConfig.VERSION_CODE,
)

/** Independent bounded queues: draining telemetry must not erase the local diagnostic report. */
internal class WindowFrameReports(private val capacity: Int = 600, private val pendingCapacity: Int = 120) {
  private val history = ArrayDeque<WindowFrameReport>()
  private val pending = ArrayDeque<WindowFrameReport>()
  private var droppedPending = 0
  private var evictedHistory = 0
  private var revision = 0L
  private var unobservedWindows = 0

  init { require(capacity > 0 && pendingCapacity > 0) }

  @Synchronized
  fun append(report: WindowFrameReport, publish: Boolean = true) {
    if (report.surface !in FRAME_SURFACES || (report.activity != "scroll" && report.activity != "other") || report.appBuild < 0) return
    if (report.values.keys != FRAME_REPORT_FIELDS || report.values.values.any { !it.isFinite() || it < 0 }) return
    if (history.size == capacity) { history.removeFirst(); evictedHistory++ }
    history.addLast(report)
    revision++
    if (publish) {
      if (pending.size == pendingCapacity) { pending.removeFirst(); droppedPending++ }
      pending.addLast(report)
    }
  }

  @Synchronized
  fun snapshot(): Snapshot = Snapshot(revision, evictedHistory, unobservedWindows, history.toList())

  @Synchronized
  fun recordCoverage(unobserved: Int) {
    if (unobservedWindows != unobserved) { unobservedWindows = unobserved; revision++ }
  }

  @Synchronized
  fun drain(): Pair<List<WindowFrameReport>, Int> {
    val result = pending.toList() to droppedPending
    pending.clear()
    droppedPending = 0
    return result
  }

  internal data class Snapshot(val revision: Long, val evictedWindows: Int, val unobservedWindows: Int, val windows: List<WindowFrameReport>)
}
