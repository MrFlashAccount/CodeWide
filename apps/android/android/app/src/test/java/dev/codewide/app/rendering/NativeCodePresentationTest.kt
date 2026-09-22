package dev.codewide.app.rendering

import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class NativeCodePresentationTest {
  @Test
  fun appendOnlyUpdateRetainsExistingHighlightSpans() {
    val highlight = ForegroundColorSpan(Color.GREEN)
    val current = SpannableString("const value").apply {
      setSpan(highlight, 0, 5, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    val updated = codePresentationWithRetainedSpans(current, "const value = 1")

    assertEquals("const value = 1", updated.toString())
    assertSame(
      highlight,
      updated.getSpans(0, updated.length, ForegroundColorSpan::class.java).single(),
    )
    assertEquals(0, updated.getSpanStart(highlight))
    assertEquals(5, updated.getSpanEnd(highlight))
  }

  @Test
  fun rewrittenSourceDropsSpansThatNoLongerDescribeTheText() {
    val highlight = ForegroundColorSpan(Color.GREEN)
    val current = SpannableString("const value").apply {
      setSpan(highlight, 0, 5, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    val updated = codePresentationWithRetainedSpans(current, "let value")

    assertEquals("let value", updated.toString())
    assertEquals(0, updated.getSpans(0, updated.length, ForegroundColorSpan::class.java).size)
  }
}
