package dev.codewide.app.performance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameWindowAccumulatorTest {
  @Test
  fun drainsFramePacingWindowAndResetsIt() {
    val accumulator = FrameWindowAccumulator()
    val interval = 16_666_667L
    accumulator.record(8_000_000L, interval, interval)
    accumulator.record(17_000_000L, interval, interval)
    accumulator.record(40_000_000L, interval, interval)

    val snapshot = accumulator.drain(1_000L)

    assertEquals(3, snapshot.renderedFrames)
    assertEquals(3.0, snapshot.renderedFps, 0.001)
    assertEquals(2, snapshot.jankFrames)
    assertEquals(3, snapshot.droppedFrameEstimate)
    assertEquals(40.0, snapshot.p95FrameMs, 0.001)
    assertTrue(snapshot.averageOverrunMs > 0.0)
    assertEquals(0, accumulator.drain(1_000L).renderedFrames)
  }

  @Test
  fun usesDisplayIntervalWhenDeadlineIsUnavailable() {
    val accumulator = FrameWindowAccumulator()
    val interval = 10_000_000L
    accumulator.record(9_000_000L, -1L, interval)
    accumulator.record(21_000_000L, -1L, interval)

    val snapshot = accumulator.drain(500L)

    assertEquals(4.0, snapshot.renderedFps, 0.001)
    assertEquals(1, snapshot.jankFrames)
    assertEquals(2, snapshot.droppedFrameEstimate)
  }
}
