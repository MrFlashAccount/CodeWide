package dev.codewide.app.performance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameIncidentBufferTest {
  @Test fun scrollingIncludesHealthyFramesForAnUnbiasedJankDenominator() {
    val buffer = FrameIncidentBuffer(includeHealthy = true)
    buffer.record(frame(8))
    buffer.flush()
    val sample = buffer.drain().first.single()
    assertEquals(1.0, sample.getValue("frameCount"), 0.001)
    assertEquals(0.0, sample.getValue("jankFrameCount"), 0.001)
  }
  private fun frame(durationMs: Long, deadlineMs: Long = 16) = FrameObservation(
    startedAtUnixMs = 1_000,
    finishedAtUnixMs = 1_000 + durationMs,
    durationNanos = durationMs * 1_000_000,
    deadlineNanos = deadlineMs * 1_000_000,
    intervalNanos = deadlineMs * 1_000_000,
    layoutNanos = 4_000_000,
    uiDelayNanos = 8_000_000,
  )

  @Test fun distinguishesMissedIntervalsFromLostReportsAndActualFrameOverruns() {
    val buffer = FrameIncidentBuffer()
    buffer.record(frame(8))
    buffer.record(frame(40).copy(droppedReports = 3))
    buffer.flush()
    val (windows, lost) = buffer.drain()
    assertEquals(0, lost)
    val values = windows.single()
    assertEquals(2.0, values.getValue("frameCount"), 0.001)
    assertEquals(1.0, values.getValue("jankFrameCount"), 0.001)
    assertEquals(2.0, values.getValue("missedVsyncEstimate"), 0.001)
    assertEquals(3.0, values.getValue("droppedMetricReports"), 0.001)
    assertEquals(40.0, values.getValue("jankFrameTotalMs"), 0.001)
    assertEquals(24.0, values.getValue("overrunTotalMs"), 0.001)
    assertEquals(8.0, values.getValue("maxUiDelayMs"), 0.001)
    assertEquals(1_000.0, values.getValue("windowStartUnixMs"), 0.001)
    assertEquals(1_040.0, values.getValue("windowEndUnixMs"), 0.001)
    assertTrue(buffer.drain().first.isEmpty())
  }

  @Test fun buffersWhileConsumerIsBlockedAndReportsOverflow() {
    val buffer = FrameIncidentBuffer(capacity = 2)
    for (duration in listOf(20L, 30L, 40L)) {
      buffer.record(frame(duration))
      buffer.flush()
    }
    val (windows, lost) = buffer.drain()
    assertEquals(1, lost)
    assertEquals(listOf(30.0, 40.0), windows.map { it.getValue("maxFrameMs") })
    assertEquals(0, buffer.drain().second)
  }

  @Test fun usesTheActualRefreshBudgetAndOmitsHealthyWindows() {
    val buffer = FrameIncidentBuffer()
    buffer.record(frame(9, 16))
    buffer.flush()
    assertTrue(buffer.drain().first.isEmpty())
    buffer.record(frame(9, 8))
    buffer.flush()
    assertEquals(1.0, buffer.drain().first.single().getValue("overrunTotalMs"), 0.001)
  }
}
