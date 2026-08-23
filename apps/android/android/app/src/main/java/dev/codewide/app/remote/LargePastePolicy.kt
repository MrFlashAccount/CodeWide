package dev.codewide.app.remote

import androidx.core.view.ContentInfoCompat

internal object LargePastePolicy {
  fun shouldIntercept(textLength: Int, minimumChars: Int, source: Int): Boolean =
    minimumChars >= 0 &&
      textLength > minimumChars &&
      (source == ContentInfoCompat.SOURCE_CLIPBOARD || source == ContentInfoCompat.SOURCE_INPUT_METHOD)
}
