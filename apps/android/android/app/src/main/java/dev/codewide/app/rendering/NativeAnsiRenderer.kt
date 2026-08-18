package dev.codewide.app.rendering

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.SpannedString
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan

internal object NativeAnsiRenderer {
  private val defaultForeground = Color.rgb(211, 215, 222)
  private val defaultBackground = Color.rgb(19, 20, 22)

  fun render(source: String): NativeCodeHighlight {
    val projection = NativeAnsiProjector.project(source)
    val text = SpannableString(projection.text)
    if (text.isNotEmpty()) {
      text.setSpan(ForegroundColorSpan(defaultForeground), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    for (run in projection.runs) {
      if (run.start >= run.end || run.end > text.length) continue
      applyStyle(text, run)
    }
    return NativeCodeHighlight(SpannedString(text), null)
  }

  private fun applyStyle(text: SpannableString, run: NativeAnsiRun) {
    val style = run.style
    var foreground = style.foreground?.opaque() ?: defaultForeground
    var background = style.background?.opaque()
    if (style.inverse) {
      val originalForeground = foreground
      foreground = background ?: defaultBackground
      background = originalForeground
    }
    if (style.dim) foreground = blend(foreground, background ?: defaultBackground, 0.55f)
    if (style.hidden) foreground = background ?: defaultBackground
    text.setSpan(ForegroundColorSpan(foreground), run.start, run.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    background?.let { text.setSpan(BackgroundColorSpan(it), run.start, run.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    val typeface = when {
      style.bold && style.italic -> Typeface.BOLD_ITALIC
      style.bold -> Typeface.BOLD
      style.italic -> Typeface.ITALIC
      else -> Typeface.NORMAL
    }
    if (typeface != Typeface.NORMAL) text.setSpan(StyleSpan(typeface), run.start, run.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (style.underline) text.setSpan(UnderlineSpan(), run.start, run.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (style.strikethrough) text.setSpan(StrikethroughSpan(), run.start, run.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  private fun Int.opaque(): Int = this or (0xff shl 24)

  private fun blend(foreground: Int, background: Int, amount: Float): Int = Color.rgb(
    (Color.red(background) + (Color.red(foreground) - Color.red(background)) * amount).toInt(),
    (Color.green(background) + (Color.green(foreground) - Color.green(background)) * amount).toInt(),
    (Color.blue(background) + (Color.blue(foreground) - Color.blue(background)) * amount).toInt(),
  )
}
