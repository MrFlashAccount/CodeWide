package dev.codewide.app.rendering

import android.text.SpannableStringBuilder

/** Preserves highlighted prefix spans while an append-only code block receives its next chunk. */
internal fun codePresentationWithRetainedSpans(
  current: CharSequence,
  next: String,
): SpannableStringBuilder {
  val currentText = current.toString()
  if (!next.startsWith(currentText)) {
    return SpannableStringBuilder(next)
  }
  return SpannableStringBuilder(current).append(next, currentText.length, next.length)
}
