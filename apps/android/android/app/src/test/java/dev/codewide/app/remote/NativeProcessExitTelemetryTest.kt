package dev.codewide.app.remote

import android.app.ApplicationExitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class NativeProcessExitTelemetryTest {
  @Test
  fun firstCollectionReportsBoundedAndroidHistory() {
    val selection = selectNativeProcessExits(
      records = listOf(record(timestampUnixMs = 800L)),
      checkpointTimestampUnixMs = null,
      nowUnixMs = 1_000L,
    )

    assertEquals(
      NativeProcessExitSelection.Report(listOf(record(timestampUnixMs = 800L)), 800L),
      selection,
    )
  }

  @Test
  fun emptyAndroidHistoryEstablishesBaselineAtCollectionTime() {
    val selection = selectNativeProcessExits(
      records = emptyList(),
      checkpointTimestampUnixMs = null,
      nowUnixMs = 1_000L,
    )

    assertEquals(NativeProcessExitSelection.EstablishBaseline(1_000L), selection)
  }

  @Test
  fun reportsOnlyExitsNewerThanDurableCheckpoint() {
    val selection = selectNativeProcessExits(
      records = listOf(record(1_300L), record(900L), record(1_100L)),
      checkpointTimestampUnixMs = 1_000L,
      nowUnixMs = 1_500L,
    )

    when (selection) {
      is NativeProcessExitSelection.Report -> {
        assertEquals(listOf(1_300L, 1_100L), selection.records.map(NativeProcessExitRecord::timestampUnixMs))
        assertEquals(1_300L, selection.checkpointTimestampUnixMs)
      }
      else -> fail("Expected unreported process exits")
    }
  }

  @Test
  fun projectsBoundedCrashCauseWithoutProcessDescriptionOrTraceContents() {
    val metric = record(
      timestampUnixMs = 1_250L,
      reason = ApplicationExitInfo.REASON_CRASH_NATIVE,
      status = 11,
      traceAvailable = true,
    ).toTelemetryMetric(nowUnixMs = 2_000L)

    assertEquals("app.previous_process_exit", metric.name)
    assertEquals("crash_native", metric.tags["reason"])
    assertEquals(11, metric.values["status"])
    assertEquals(750L, metric.values["ageMs"])
    assertEquals(1, metric.values["traceAvailable"])
  }

  private fun record(
    timestampUnixMs: Long,
    reason: Int = ApplicationExitInfo.REASON_CRASH,
    status: Int = 0,
    traceAvailable: Boolean = false,
  ) = NativeProcessExitRecord(
    timestampUnixMs = timestampUnixMs,
    reason = reason,
    status = status,
    importance = 100,
    pssKb = 256_000L,
    rssKb = 512_000L,
    mainProcess = true,
    traceAvailable = traceAvailable,
  )
}
