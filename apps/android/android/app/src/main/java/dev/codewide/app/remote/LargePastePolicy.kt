package dev.codewide.app.remote

import androidx.core.view.ContentInfoCompat

internal object LargePastePolicy {
  fun shouldIntercept(textLength: Int, minimumChars: Int, source: Int): Boolean =
    minimumChars >= 0 &&
      textLength > minimumChars &&
      (source == ContentInfoCompat.SOURCE_CLIPBOARD || source == ContentInfoCompat.SOURCE_INPUT_METHOD)

  fun shouldInterceptClipboardChunk(
    chunkText: String,
    clipboardText: String,
    minimumChars: Int,
  ): Boolean =
    minimumChars >= 0 &&
      chunkText.length > minimumChars &&
      clipboardText.length > minimumChars &&
      clipboardText.startsWith(chunkText)
}

internal class LargePasteChunkSuppression {
  private var text: String? = null
  private var offset = 0

  fun begin(clipboardText: String, consumedChars: Int) {
    if (consumedChars >= clipboardText.length) {
      clear()
      return
    }
    text = clipboardText
    offset = consumedChars
  }

  fun consume(chunkText: String): Boolean {
    val activeText = text ?: return false
    if (chunkText.isEmpty() || !activeText.regionMatches(offset, chunkText, 0, chunkText.length)) {
      clear()
      return false
    }
    offset += chunkText.length
    if (offset >= activeText.length) clear()
    return true
  }

  private fun clear() {
    text = null
    offset = 0
  }
}
