package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SplashExitTimingTest {
  @Test
  fun separatesReadinessSchedulingAndActualAnimation() {
    val trace = SplashExitTrace(420_000_000L)
    trace.started(435_000_000L)
    val timing = trace.finish(400_000_000L, 10_000_000L, 562_000_000L, false)
    assertEquals(20.0, timing.contentToExitMs, 0.001)
    assertEquals(15.0, timing.animationStartDelayMs, 0.001)
    // A nominal 100 ms animation can take longer when frames are delayed.
    assertEquals(127.0, timing.animationDurationMs, 0.001)
    assertEquals(552.0, timing.applicationEntryToSplashRemovedMs, 0.001)
    assertFalse(timing.cancelled)
  }

  @Test
  fun retainsSubMillisecondPrecisionAndCancelledOutcome() {
    val trace = SplashExitTrace(1_000_000L)
    trace.started(1_250_000L)
    val timing = trace.finish(500_000L, 0L, 2_750_000L, true)
    assertEquals(0.5, timing.contentToExitMs, 0.001)
    assertEquals(0.25, timing.animationStartDelayMs, 0.001)
    assertEquals(1.5, timing.animationDurationMs, 0.001)
    assertEquals(2.75, timing.applicationEntryToSplashRemovedMs, 0.001)
    assertTrue(timing.cancelled)
  }
}
