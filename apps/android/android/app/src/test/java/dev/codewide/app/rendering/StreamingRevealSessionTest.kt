package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingRevealSessionTest {
  @Test
  fun openingAnActiveMessagePresentsEveryExistingParagraphImmediately() {
    val session = StreamingRevealSession()
    for (text in listOf("Already materialized", "Another paragraph")) {
      val state = session.createState(text.length, true)
      state.update(text, 1000L, true)
      assertEquals(text, state.source)
      assertTrue(state.glyphs.isEmpty())
    }
  }

  @Test
  fun onlySubsequentTextAndParagraphsAnimateWhileTheMessageIsVisible() {
    val session = StreamingRevealSession()
    val state = session.createState(5, true)
    state.update("Hello", 1000L, true)
    session.didPresentText()
    state.update("Hello world", 1100L, true)
    assertFalse(state.glyphs.isEmpty())
    assertTrue(state.glyphs.all { it.start >= 5 })
    val paragraph = session.createState(4, true)
    paragraph.update("Next", 1101L, true)
    assertEquals(0, paragraph.glyphs.first().start)
    assertEquals(0f, paragraph.glyphs.first().opacity(1101L), 0f)
  }

  @Test
  fun returningAfterHiddenUpdatesDoesNotReplayAnUnfinishedReveal() {
    val session = StreamingRevealSession()
    val state = session.createState(5, true)
    state.update("Hello", 1000L, true)
    session.didPresentText()
    state.update("Hello world", 1100L, true)
    assertTrue(state.glyphs.any { it.opacity(1100L) < 1f })
    session.reset()
    val latest = "Hello world, received while hidden"
    val reopened = session.createState(latest.length, true)
    reopened.update(latest, 1200L, true)
    assertTrue(reopened.glyphs.isEmpty())
    session.didPresentText()
    reopened.update("$latest!", 1300L, true)
    assertEquals(latest.length, reopened.glyphs.single().start)
  }

  @Test
  fun completedContentNeverStartsANewReveal() {
    val session = StreamingRevealSession()
    session.didPresentText()
    val state = session.createState(4, false)
    state.update("Done", 1000L, false)
    state.update("Done!", 1100L, false)
    assertTrue(state.glyphs.isEmpty())
  }
}
