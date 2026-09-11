package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeSearchRangesTest {
  @Test fun matchesRepeatedTermsWithoutChangingUtf16Offsets() {
    val source = "🧪 Hello hello\nworld"
    assertEquals(listOf("Hello", "hello", "world"), nativeSearchRanges(source, "HELLO world").map(source::substring))
    assertEquals(3, nativeSearchRanges(source, "hello").first().first)
  }

  @Test fun emptyOrMissingTermsDoNotHighlightAnything() {
    assertEquals(emptyList<IntRange>(), nativeSearchRanges("text", "  "))
    assertEquals(emptyList<IntRange>(), nativeSearchRanges("text", "absent"))
  }
}
