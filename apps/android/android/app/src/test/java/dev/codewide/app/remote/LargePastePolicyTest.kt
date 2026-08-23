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
}
