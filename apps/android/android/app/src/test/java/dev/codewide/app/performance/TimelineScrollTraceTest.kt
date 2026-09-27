package dev.codewide.app.performance

import org.junit.Assert.*
import org.junit.Test

class TimelineScrollTraceTest {
  private fun geometry(offset: Int, time: Long, phase: TimelineGeometryPhase = TimelineGeometryPhase.SCROLL) =
    TimelineTraceEvent.Geometry(1_000_000 + time, time, 11, phase, offset, 19025, 1786, 4, true, 1f, 1f, 0)

  private fun frame(time: Long) = TimelineTraceEvent.Frame(1_000_000 + time, time, 22.0, 16.7, 5.0, 3.0, -1.0, 2.0, 1)

  @Test fun retainsDrawnOffsetsAndFramesBeforeAndAfterAJumpWithoutJsOrHud() {
    val trace = TimelineScrollTrace(capacity = 12, beforeCount = 4, afterCount = 3)
    trace.geometry(geometry(17239, 100, TimelineGeometryPhase.DRAW), false)
    trace.frame(frame(104))
    trace.geometry(geometry(181, 108), true)
    trace.geometry(geometry(17239, 116), false)
    trace.geometry(geometry(50, 124), true)
    trace.geometry(geometry(50, 132, TimelineGeometryPhase.DRAW), false)
    val capture = trace.snapshot().captures.single()
    assertEquals(listOf(17239, 181, 17239, 50, 50), capture.entries.mapNotNull { (it.event as? TimelineTraceEvent.Geometry)?.offsetPx })
    assertEquals(listOf(17239, 50), capture.entries.mapNotNull {
      (it.event as? TimelineTraceEvent.Geometry)?.takeIf { value -> value.phase == TimelineGeometryPhase.DRAW }?.offsetPx
    })
    assertEquals(1, capture.entries.count { it.event is TimelineTraceEvent.Frame })
    assertEquals(capture.triggerSequence, capture.entries.first { it.event == geometry(181, 108) }.sequence)
    // Later reading/Settings activity must not overwrite the incident evidence.
    repeat(30) { trace.geometry(geometry(0, 200L + it), false) }
    assertEquals(capture, trace.snapshot().captures.single())
    assertTrue(trace.snapshot().evicted > 0)
  }

  @Test fun boundsCapturesAndDoesNotMutateAnExportedSnapshot() {
    val trace = TimelineScrollTrace(capacity = 6, beforeCount = 2, afterCount = 1, captureCapacity = 2)
    trace.geometry(geometry(0, 1), true)
    val exported = trace.snapshot()
    repeat(8) { trace.geometry(geometry(it, 10L + it), true) }
    assertEquals(1, exported.entries.size)
    assertEquals(1, exported.captures.single().entries.size)
    assertEquals(2, trace.snapshot().captures.size)
    assertTrue(trace.snapshot().captures.all { it.entries.size <= 3 })
    assertTrue(trace.snapshot().evictedCaptures > 0)
  }

  @Test fun recordsNoUnrelatedFramesAndMakesMissingCoverageExplicit() {
    val trace = TimelineScrollTrace()
    trace.frame(frame(100))
    assertEquals(0L, trace.snapshot().frameCount)
    trace.geometry(geometry(0, 110), false)
    assertTrue(trace.needsFrame(120))
    trace.frame(frame(120))
    trace.frame(frame(2111))
    assertFalse(trace.needsFrame(2111))
    assertEquals(1L, trace.snapshot().frameCount)
    assertEquals(0L, trace.snapshot().drawCount)
    val frames = trace.snapshot().entries.map { it.event }.filterIsInstance<TimelineTraceEvent.Frame>()
    assertEquals(-1.0, frames.single().gpuMs, 0.0)
  }
}
