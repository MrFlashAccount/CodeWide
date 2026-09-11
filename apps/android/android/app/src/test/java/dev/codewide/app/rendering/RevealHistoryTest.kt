package dev.codewide.app.rendering

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RevealHistoryTest {
  @Test fun completedBlocksStayVisibleWhenRecycledButOtherTurnsStillReveal() {
    val first = RevealHistory.key("turn:first:table:row:0")
    val other = RevealHistory.key("turn:other:table:row:0")
    RevealHistory.record(first)
    assertTrue(RevealHistory.contains(first))
    assertFalse(RevealHistory.contains(other))
  }

  @Test fun historyIsBounded() {
    val oldest = RevealHistory.key("eviction:first")
    RevealHistory.record(oldest)
    for (index in 0 until 128) RevealHistory.record(RevealHistory.key("eviction:$index"))
    assertFalse(RevealHistory.contains(oldest))
    assertTrue(RevealHistory.contains(RevealHistory.key("eviction:127")))
  }
}
