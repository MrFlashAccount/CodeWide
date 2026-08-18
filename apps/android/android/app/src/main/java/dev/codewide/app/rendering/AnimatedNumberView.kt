package dev.codewide.app.rendering

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.icu.text.CompactDecimalFormat
import android.icu.text.NumberFormat
import android.icu.util.Currency
import android.view.View
import android.view.animation.PathInterpolator
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.PixelUtil
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

class AnimatedNumberView(context: Context) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
    color = Color.WHITE
    textSize = PixelUtil.toPixelFromSP(14f)
    fontFeatureSettings = "tnum"
  }
  private var pendingValue = 0.0
  private var pendingFormatStyle = "decimal"
  private var pendingCurrency: String? = null
  private var pendingMinimumFractionDigits = 0
  private var pendingMaximumFractionDigits = 3
  private var pendingPrefix = ""
  private var pendingSuffix = ""
  private var pendingColor: Int? = null
  private var pendingFontSize = 14f
  private var pendingLineHeight = 18f
  private var pendingFontFamily: String? = null
  private var pendingFontWeight: String? = null
  private var pendingTextAlign = "left"
  private var pendingAnimate = true
  private var pendingAccessibilityLabel: String? = null

  private var committedValue: Double? = null
  private var previousText = ""
  private var targetText = ""
  private var progress = 1f
  private var direction = 1f
  private var lineHeightPx = PixelUtil.toPixelFromDIP(18f)
  private var animator: ValueAnimator? = null

  init {
    setWillNotDraw(false)
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  fun setPendingValue(value: Double) { pendingValue = if (value.isFinite()) value else 0.0 }
  fun setPendingFormatStyle(value: String?) { pendingFormatStyle = value ?: "decimal" }
  fun setPendingCurrency(value: String?) { pendingCurrency = value }
  fun setPendingMinimumFractionDigits(value: Int) { pendingMinimumFractionDigits = value.coerceIn(0, 20) }
  fun setPendingMaximumFractionDigits(value: Int) { pendingMaximumFractionDigits = value.coerceIn(0, 20) }
  fun setPendingPrefix(value: String?) { pendingPrefix = value ?: "" }
  fun setPendingSuffix(value: String?) { pendingSuffix = value ?: "" }
  fun setPendingColor(value: Int?) { pendingColor = value }
  fun setPendingFontSize(value: Float) { pendingFontSize = value }
  fun setPendingLineHeight(value: Float) { pendingLineHeight = value }
  fun setPendingFontFamily(value: String?) { pendingFontFamily = value }
  fun setPendingFontWeight(value: String?) { pendingFontWeight = value }
  fun setPendingTextAlign(value: String?) { pendingTextAlign = value ?: "left" }
  fun setPendingAnimate(value: Boolean) { pendingAnimate = value }
  fun setPendingAccessibilityLabel(value: String?) { pendingAccessibilityLabel = value }

  fun commitProps() {
    paint.color = pendingColor ?: Color.WHITE
    paint.textSize = PixelUtil.toPixelFromSP(max(1f, pendingFontSize))
    lineHeightPx = PixelUtil.toPixelFromDIP(max(pendingFontSize, pendingLineHeight))
    val typefaceStyle = if (fontWeight() >= 600) Typeface.BOLD else Typeface.NORMAL
    paint.typeface = pendingFontFamily?.let {
      ReactFontManager.getInstance().getTypeface(it, typefaceStyle, context.assets)
    } ?: Typeface.create("sans-serif", typefaceStyle)
    val nextText = pendingPrefix + formatter().format(pendingValue) + pendingSuffix
    contentDescription = pendingAccessibilityLabel ?: nextText
    val oldValue = committedValue
    committedValue = pendingValue
    if (targetText.isEmpty() || oldValue == null || !pendingAnimate || !ValueAnimator.areAnimatorsEnabled()) {
      animator?.cancel()
      previousText = nextText
      targetText = nextText
      progress = 1f
      invalidate()
      return
    }
    if (nextText == targetText) {
      previousText = nextText
      progress = 1f
      invalidate()
      return
    }
    animator?.cancel()
    previousText = targetText
    targetText = nextText
    direction = if (pendingValue >= oldValue) 1f else -1f
    progress = 0f
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 360L
      interpolator = PathInterpolator(0.22f, 1f, 0.36f, 1f)
      addUpdateListener {
        progress = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (targetText.isEmpty()) return
    canvas.save()
    canvas.clipRect(0f, 0f, width.toFloat(), height.toFloat())
    val baseline = (height - paint.fontMetrics.descent - paint.fontMetrics.ascent) / 2f
    if (progress >= 1f || previousText == targetText) {
      canvas.drawText(targetText, horizontalStart(targetText), baseline, paint)
      canvas.restore()
      return
    }

    val oldCharacters = previousText.toList()
    val newCharacters = targetText.toList()
    val slotCount = max(oldCharacters.size, newCharacters.size)
    val oldOffset = slotCount - oldCharacters.size
    val newOffset = slotCount - newCharacters.size
    var x = horizontalStart(targetText)
    val travel = min(lineHeightPx, height.toFloat())
    for (slot in 0 until slotCount) {
      val oldCharacter = oldCharacters.getOrNull(slot - oldOffset)
      val newCharacter = newCharacters.getOrNull(slot - newOffset)
      val oldText = oldCharacter?.toString()
      val newText = newCharacter?.toString()
      val widthForSlot = max(
        oldText?.let(paint::measureText) ?: 0f,
        newText?.let(paint::measureText) ?: 0f,
      )
      if (oldCharacter == newCharacter && newText != null) {
        canvas.drawText(newText, x, baseline, paint)
      } else {
        val originalAlpha = paint.alpha
        if (oldText != null) {
          paint.alpha = ((1f - progress) * 255f).toInt().coerceIn(0, 255)
          canvas.drawText(oldText, x, baseline - direction * travel * progress, paint)
        }
        if (newText != null) {
          paint.alpha = (progress * 255f).toInt().coerceIn(0, 255)
          canvas.drawText(newText, x, baseline + direction * travel * (1f - progress), paint)
        }
        paint.alpha = originalAlpha
      }
      x += widthForSlot
    }
    canvas.restore()
  }

  fun release() {
    animator?.cancel()
    animator = null
  }

  private fun formatter(): NumberFormat {
    val locale = resources.configuration.locales[0] ?: Locale.getDefault()
    val format = when (pendingFormatStyle) {
      "compact" -> CompactDecimalFormat.getInstance(locale, CompactDecimalFormat.CompactStyle.SHORT)
      "currency" -> NumberFormat.getCurrencyInstance(locale).apply {
        pendingCurrency?.let { runCatching { currency = Currency.getInstance(it) } }
      }
      else -> NumberFormat.getNumberInstance(locale)
    }
    val maximum = max(pendingMinimumFractionDigits, pendingMaximumFractionDigits)
    format.minimumFractionDigits = min(pendingMinimumFractionDigits, maximum)
    format.maximumFractionDigits = maximum
    format.isGroupingUsed = pendingFormatStyle != "compact"
    return format
  }

  private fun fontWeight(): Int = when (pendingFontWeight) {
    "bold" -> 700
    else -> pendingFontWeight?.toIntOrNull() ?: 400
  }

  private fun horizontalStart(text: String): Float {
    val remaining = max(0f, width - paint.measureText(text))
    return when (pendingTextAlign) {
      "center" -> remaining / 2f
      "right" -> remaining
      else -> 0f
    }
  }
}
