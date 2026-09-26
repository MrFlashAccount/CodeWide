package dev.codewide.app.performance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TimelineScrollIncidentsTest {
  private fun point(offset: Int, time: Long, height: Int = 6023, view: Int = 1) =
    TimelineScrollPoint(view, 1_000_000 + time, time, offset, height, 983)

  private val propStack = arrayOf(
    StackTraceElement("com.facebook.react.views.scroll.ReactScrollView", "setContentOffset", "ReactScrollView.java", 1336),
    StackTraceElement("private.user.content", "notExported", "secret", 1),
  )

  @Test fun capturesManualEndToTopReturnWithoutAnAppCommand() {
    val journal = TimelineScrollIncidents()
    journal.record(point(4877, 100)) { error("No stack on normal samples") }
    journal.record(point(5039, 116)) { error("No stack on normal samples") }
    journal.record(point(0, 132)) { propStack }
    val incident = journal.snapshot().single()
    assertEquals(5039, incident.previous.offsetPx)
    assertEquals(0, incident.current.offsetPx)
    assertEquals("content-offset-prop", incident.source)
    assertEquals(listOf("com.facebook.react.views.scroll.ReactScrollView.setContentOffset:1336"), incident.stack)
  }

  @Test fun skipsNormalMotionResizesStaleSamplesAndDifferentLists() {
    val journal = TimelineScrollIncidents()
    val noCapture = { error("Unexpected stack collection") }
    journal.record(point(4900, 100), noCapture)
    journal.record(point(4800, 116), noCapture)
    journal.record(point(0, 132, height = 983), noCapture)
    journal.record(point(4900, 200), noCapture)
    journal.record(point(0, 600), noCapture)
    journal.record(point(4900, 616), noCapture)
    journal.record(point(0, 632, view = 2), noCapture)
    assertTrue(journal.snapshot().isEmpty())
  }

  @Test fun keepsOnlyBoundedRecentIncidents() {
    val journal = TimelineScrollIncidents(capacity = 2)
    repeat(5) { index ->
      journal.record(point(5000, index * 32L)) { propStack }
      journal.record(point(0, index * 32L + 16)) { propStack }
    }
    assertEquals(2, journal.snapshot().size)
    assertEquals(3, journal.evicted)
    assertEquals(144L, journal.snapshot().last().current.uptimeMs)
  }

  @Test fun distinguishesNativeVisibleContentCorrectionFromUnknownOrigin() {
    val journal = TimelineScrollIncidents()
    journal.record(point(5000, 100)) { emptyArray() }
    journal.record(point(0, 116)) { arrayOf(
      StackTraceElement("com.facebook.react.views.scroll.MaintainVisibleScrollPositionHelper", "updateScrollPositionInternal", "helper.kt", 99),
    ) }
    assertEquals("visible-content-adjustment", journal.snapshot().single().source)
    journal.record(point(5000, 200)) { emptyArray() }
    journal.record(point(0, 216)) { emptyArray() }
    assertEquals("unknown", journal.snapshot().last().source)
  }
}
