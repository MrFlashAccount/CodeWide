package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingRevealStateTest {
  @Test
  fun appendedTextFadesContinuouslyInReadingOrder() {
    val state = StreamingRevealState()
    state.update("Hello", 1000L, true)
    val first = state.glyphs.first()
    val last = state.glyphs.last()
    assertEquals(0f, first.opacity(1000L), 0f)
    assertTrue(first.opacity(1025L) in 0.01f..0.99f)
    assertTrue(first.opacity(1025L) > last.opacity(1025L))
    assertEquals(1f, last.opacity(1500L), 0f)
    assertEquals("Hello", state.source)
  }

  @Test
  fun newBatchesDoNotRestartAnInFlightWaveOrSettledPrefix() {
    val state = StreamingRevealState()
    state.update("Hello", 1000L, true)
    val first = state.glyphs.first()
    state.update("Hello world", 1020L, true)
    assertEquals(first, state.glyphs.first())
    val earlierOpacity = first.opacity(1020L)
    assertTrue(first.opacity(1040L) > earlierOpacity)
    state.update("Hello world!", 2000L, true)
    assertEquals(1, state.glyphs.size)
    assertEquals(11, state.glyphs.single().start)
  }

  @Test
  fun recyclingRestoresSettledTextAndOnlyRevealsUnseenSuffix() {
    val state = StreamingRevealState(seenLength = 5)
    state.update("Hello", 1000L, true)
    assertTrue(state.glyphs.isEmpty())
    state.update("Hello again", 1100L, true)
    assertTrue(state.glyphs.all { it.start >= 5 })
  }

  @Test
  fun replacementAndReducedMotionImmediatelyExposeCompleteText() {
    val state = StreamingRevealState()
    state.update("Draft", 1000L, true)
    state.update("Corrected answer", 1100L, true)
    assertEquals("Corrected answer", state.source)
    assertTrue(state.glyphs.isEmpty())
    state.update("Corrected answer!", 1200L, true)
    assertFalse(state.glyphs.isEmpty())
    state.update("Corrected answer!", 1200L, false)
    assertTrue(state.glyphs.isEmpty())
  }

  @Test
  fun largeBurstsBoundAnimationWithoutDroppingOrDelayingContent() {
    val state = StreamingRevealState()
    val text = "x".repeat(100_000)
    state.update(text, 1000L, true)
    assertEquals(text, state.source)
    assertTrue(state.glyphs.size <= StreamingRevealState.MAX_NEW_SPANS)
    assertEquals(0, state.glyphs.first().start)
    assertEquals(text.length, state.glyphs.last().end)
    assertTrue(state.glyphs.all { it.opacity(1000L) == 0f })
    assertTrue(state.glyphs.all { it.finished(2200L) })
  }

  @Test
  fun waveDoesNotSplitSurrogatePairsOrCombiningMarks() {
    val state = StreamingRevealState()
    val text = "A😀e\u0301Я"
    state.update(text, 1000L, true)
    val glyphs = state.glyphs.map { text.substring(it.start, it.end) }
    assertEquals(listOf("A", "😀", "e\u0301", "Я"), glyphs)
  }

  @Test
  fun batchesAndParagraphsShareOneFrontAndNeverOvertakeEarlierLetters() {
    val clock = StreamingRevealClock()
    val first = StreamingRevealState(clock = clock)
    val second = StreamingRevealState(clock = clock)
    first.update("First second third fourth fifth sixth", 1000L, true)
    second.update("Next paragraph", 1010L, true)
    first.update("First second third fourth fifth sixth!", 1020L, true)
    val all = (first.glyphs + second.glyphs).sortedBy { it.position }
    for (now in 1020L..1600L step 16) {
      val alpha = all.map { it.opacity(now) }
      assertTrue(alpha.zipWithNext().all { (left, right) -> left >= right })
    }
  }

  @Test
  fun crossingOldTailLimitDoesNotExposeOrDropAnimatingPrefix() {
    val state = StreamingRevealState()
    state.update("x".repeat(512), 1000L, true)
    val first = state.glyphs.first()
    state.update("x".repeat(540), 1001L, true)
    assertEquals(first, state.glyphs.first())
    assertTrue(first.opacity(1001L) < 1f)
    assertTrue(state.settledLength(1001L) < 512)
  }
}
