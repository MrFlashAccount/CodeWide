package dev.codewide.app.remote

import androidx.core.view.ContentInfoCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LargePastePolicyTest {
  @Test
  fun interceptsLargeClipboardAndKeyboardPastePayloads() {
    assertFalse(LargePastePolicy.shouldIntercept(9_999, 10_000, ContentInfoCompat.SOURCE_CLIPBOARD))
    assertFalse(LargePastePolicy.shouldIntercept(10_000, 10_000, ContentInfoCompat.SOURCE_CLIPBOARD))
    assertTrue(LargePastePolicy.shouldIntercept(10_001, 10_000, ContentInfoCompat.SOURCE_CLIPBOARD))
    assertTrue(LargePastePolicy.shouldIntercept(10_001, 10_000, ContentInfoCompat.SOURCE_INPUT_METHOD))
    assertFalse(LargePastePolicy.shouldIntercept(10_001, 10_000, ContentInfoCompat.SOURCE_DRAG_AND_DROP))
  }

  @Test
  fun recognizesTheFirstSamsungCommitTextChunkFromTheFullClipboard() {
    val clipboard = "a".repeat(20_000) + "b".repeat(30_000)

    assertTrue(
      LargePastePolicy.shouldInterceptClipboardChunk(
        chunkText = clipboard.take(20_000),
        clipboardText = clipboard,
        minimumChars = 10_000,
      ),
    )
    assertFalse(
      LargePastePolicy.shouldInterceptClipboardChunk(
        chunkText = clipboard.drop(20_000).take(20_000),
        clipboardText = clipboard,
        minimumChars = 10_000,
      ),
    )
    assertFalse(
      LargePastePolicy.shouldInterceptClipboardChunk(
        chunkText = clipboard.take(10_000),
        clipboardText = clipboard,
        minimumChars = 10_000,
      ),
    )
  }

  @Test
  fun suppressesEveryRemainingChunkButNotTheNextIndependentEdit() {
    val suppression = LargePasteChunkSuppression()
    val clipboard = "a".repeat(20_000) + "b".repeat(20_000) + "c".repeat(5_000)

    suppression.begin(clipboard, 20_000)

    assertTrue(suppression.consume("b".repeat(20_000)))
    assertTrue(suppression.consume("c".repeat(5_000)))
    assertFalse(suppression.consume("typed"))
  }

  @Test
  fun abandonsSuppressionWhenTheKeyboardStartsAnotherEdit() {
    val suppression = LargePasteChunkSuppression()
    suppression.begin("a".repeat(20_000) + "b".repeat(20_000), 20_000)

    assertFalse(suppression.consume("different"))
    assertFalse(suppression.consume("b".repeat(20_000)))
  }
}
