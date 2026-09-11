package dev.codewide.app.performance

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrollActivityHistoryTest {
  @Test fun keepsOldScrollAttributionWhenFrameDeliveryIsDelayed() {
    val history = ScrollActivityHistory()
    history.record(1_000_000_000)
    history.record(10_000_000_000)
    assertTrue(history.contains(980_000_000))
    assertTrue(history.contains(1_200_000_000))
    assertFalse(history.contains(5_000_000_000))
    assertFalse(history.contains(10_300_000_000))
  }

  @Test fun continuousFlingDoesNotEvictItsBeginning() {
    val history = ScrollActivityHistory()
    for (index in 1..10_000) history.record(index * 16_000_000L)
    assertTrue(history.contains(16_000_000))
    assertTrue(history.contains(159_000_000_000))
  }

  @Test fun boundsIsolatedGestures() {
    val history = ScrollActivityHistory()
    for (index in 1..1_000) history.record(index * 1_000_000_000L)
    assertFalse(history.contains(1_000_000_000))
    assertTrue(history.contains(1_000_000_000_000))
  }
}
