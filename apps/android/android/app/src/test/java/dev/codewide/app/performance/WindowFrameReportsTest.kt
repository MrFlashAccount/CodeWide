package dev.codewide.app.performance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WindowFrameReportsTest {
  private fun report(at: Double) = WindowFrameReport("ports", "scroll", FRAME_REPORT_FIELDS.associateWith {
    if (it == "windowStartUnixMs" || it == "windowEndUnixMs") at else 0.0
  }, appBuild = 145)

  @Test fun deliveryDoesNotEraseLocalHistoryAndQueuesStayBounded() {
    val reports = WindowFrameReports(capacity = 3, pendingCapacity = 2)
    for (index in 1..4) reports.append(report(index.toDouble()))
    val (sent, dropped) = reports.drain()
    assertEquals(listOf(3.0, 4.0), sent.map { it.values.getValue("windowStartUnixMs") })
    assertEquals(2, dropped)
    assertTrue(reports.drain().first.isEmpty())
    assertEquals(3, reports.snapshot().windows.size)
    assertEquals(1, reports.snapshot().evictedWindows)
  }

  @Test fun restoredReportsRetainTheirBuildWithoutBeingSentAgain() {
    val reports = WindowFrameReports()
    reports.append(report(1.0), publish = false)
    assertTrue(reports.drain().first.isEmpty())
    assertEquals(145, reports.snapshot().windows.single().appBuild)
  }

  @Test fun rejectsContentAndInvalidNumbersAtThePersistenceBoundary() {
    val reports = WindowFrameReports()
    reports.append(report(1.0).copy(surface = "/private/path"))
    reports.append(report(1.0).copy(values = mapOf("content" to 1.0)))
    reports.append(report(Double.NaN))
    assertTrue(reports.snapshot().windows.isEmpty())
    reports.recordCoverage(2)
    assertEquals(2, reports.snapshot().unobservedWindows)
  }
}
