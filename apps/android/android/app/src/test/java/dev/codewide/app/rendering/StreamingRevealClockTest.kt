package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingRevealClockTest {
  @Test fun readingSpeedIsTwelvePercentFasterWithoutChangingFadeShape() {
    val clock = StreamingRevealClock()
    val position = clock.reserve(1000L)
    val phase = 70.0 * 1.12 * 0.025 / 4.0
    assertEquals((phase * phase * (3.0 - 2.0 * phase)).toFloat(), clock.opacity(position, 1025L), 0.00001f)
  }

  @Test fun shimmerTravelsAfterOpacityAndRestoresInkWithoutHidingText() {
    val clock = StreamingRevealClock()
    val position = clock.reserve(1000L)
    assertEquals(0f, clock.highlight(position, 1000L), 0f)
    assertEquals(1f, clock.opacity(position, 1100L), 0f)
    assertTrue(clock.highlight(position, 1100L) > 0.3f)
    assertTrue(!clock.finished(position, 1100L))
    assertTrue(clock.finished(position, 1500L))
    assertEquals(0f, clock.highlight(position, 1500L), 0.00001f)
    assertEquals(1f, clock.opacity(position, 1500L), 0f)
  }

  @Test fun laterBatchDoesNotChangeCurrentOpacityOrStartAheadOfPendingLetters() {
    val clock = StreamingRevealClock()
    val first = clock.reserve(1000L)
    val second = clock.reserve(1000L)
    val before = clock.opacity(first, 1020L)
    val later = clock.reserve(1020L)
    assertEquals(before, clock.opacity(first, 1020L), 0f)
    assertEquals(0f, clock.opacity(later, 1020L), 0f)
    assertTrue(clock.opacity(first, 1040L) > clock.opacity(second, 1040L))
  }

  @Test fun frameCadenceDoesNotChangeReadingPosition() {
    val frequent = StreamingRevealClock()
    val sparse = StreamingRevealClock()
    repeat(100) { frequent.reserve(1000L); sparse.reserve(1000L) }
    for (now in 1010L..1400L step 10) frequent.opacity(70.0, now)
    assertEquals(frequent.opacity(70.0, 1400L), sparse.opacity(70.0, 1400L), 0.00001f)
  }

  @Test fun aBurstAcceleratesWithoutInstantlyRevealingItsPrefix() {
    val clock = StreamingRevealClock()
    val positions = List(512) { clock.reserve(1000L) }
    assertTrue(positions.all { clock.opacity(it, 1000L) == 0f })
    assertTrue(clock.opacity(positions.first(), 1001L) in 0.01f..0.99f)
    assertTrue(positions.all { clock.opacity(it, 2200L) == 1f })
  }
}
