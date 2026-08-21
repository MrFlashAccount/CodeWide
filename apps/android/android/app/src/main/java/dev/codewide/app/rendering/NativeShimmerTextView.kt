package dev.codewide.app.rendering

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import androidx.core.graphics.ColorUtils
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.PixelUtil
import kotlin.math.ceil
import kotlin.math.max

class NativeShimmerTextView(context: Context) : ViewGroup(context) {
  private companion object {
    const val SWEEP_DURATION_MS = 2_500L
  }

  private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
    color = Color.WHITE
    textSize = PixelUtil.toPixelFromSP(14f)
  }
  private val textPath = Path()
  private val bandView = GradientBandView(context)
  private val linearInterpolator = LinearInterpolator()

  private var pendingText = ""
  private var pendingColor = Color.WHITE
  private var pendingFontSize = 14f
  private var pendingFontFamily: String? = null
  private var pendingFontWeight: String? = null
  private var pendingTextAlign = "left"
  private var pendingAnimate = true

  private var displayText = ""
  private var bandWidthPx = 0f
  private var textStartPx = 0f
  private var textBaselinePx = 0f
  private var animationGeneration = 0
  private var aggregatedVisible = true

  init {
    setWillNotDraw(false)
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    bandView.visibility = INVISIBLE
    addView(bandView)
  }

  fun setPendingText(value: String?) { pendingText = value ?: "" }
  fun setPendingColor(value: Int?) { pendingColor = value ?: Color.WHITE }
  fun setPendingFontSize(value: Float) { pendingFontSize = value }
  fun setPendingFontFamily(value: String?) { pendingFontFamily = value }
  fun setPendingFontWeight(value: String?) { pendingFontWeight = value }
  fun setPendingTextAlign(value: String?) { pendingTextAlign = value ?: "left" }
  fun setPendingAnimate(value: Boolean) { pendingAnimate = value }

  fun commitProps() {
    paint.textSize = PixelUtil.toPixelFromSP(max(1f, pendingFontSize))
    val typefaceStyle = if (fontWeight() >= 600) Typeface.BOLD else Typeface.NORMAL
    paint.typeface = pendingFontFamily?.let {
      ReactFontManager.getInstance().getTypeface(it, typefaceStyle, context.assets)
    } ?: Typeface.create("sans-serif", typefaceStyle)
    rebuildTextGeometry()
    configureBand()
    updateAnimation()
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    updateAnimation()
  }

  override fun onDetachedFromWindow() {
    stopAnimation()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    updateAnimation()
  }

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    aggregatedVisible = isVisible
    updateAnimation()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    rebuildTextGeometry()
    configureBand()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    val childWidth = max(1, ceil(bandWidthFor(measuredWidth)).toInt())
    val childHeight = max(1, measuredHeight)
    bandView.measure(
      MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(childHeight, MeasureSpec.EXACTLY),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    bandView.layout(0, 0, bandView.measuredWidth, bandView.measuredHeight)
    if (changed) updateAnimation()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (displayText.isEmpty()) return
    paint.shader = null
    val baseAlpha = (Color.alpha(pendingColor) * 0.58f).toInt().coerceIn(0, 255)
    paint.color = ColorUtils.setAlphaComponent(pendingColor, baseAlpha)
    canvas.drawText(displayText, textStartPx, textBaselinePx, paint)
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (!shouldAnimate() || textPath.isEmpty) return
    val checkpoint = canvas.save()
    canvas.clipPath(textPath)
    super.dispatchDraw(canvas)
    canvas.restoreToCount(checkpoint)
  }

  fun release() {
    stopAnimation()
    paint.shader = null
    textPath.reset()
  }

  private fun rebuildTextGeometry() {
    if (width <= 0) {
      displayText = pendingText
      textPath.reset()
      return
    }
    displayText = TextUtils.ellipsize(
      pendingText,
      paint,
      width.toFloat(),
      TextUtils.TruncateAt.END,
    ).toString()
    textStartPx = horizontalStart(displayText)
    textBaselinePx = (height - paint.fontMetrics.descent - paint.fontMetrics.ascent) / 2f
    textPath.reset()
    if (displayText.isNotEmpty()) {
      paint.getTextPath(displayText, 0, displayText.length, textStartPx, textBaselinePx, textPath)
    }
  }

  private fun configureBand() {
    bandWidthPx = bandWidthFor(width)
    val highlightColor = ColorUtils.setAlphaComponent(Color.WHITE, Color.alpha(pendingColor))
    bandView.configure(bandWidthPx, highlightColor)
    requestLayout()
    updateAnimation()
  }

  private fun shouldAnimate(): Boolean =
    pendingAnimate && ValueAnimator.areAnimatorsEnabled() && isAttachedToWindow && aggregatedVisible && isShown &&
      width > 0 && height > 0 && displayText.isNotEmpty()

  private fun updateAnimation() {
    stopAnimation()
    if (!shouldAnimate()) return
    bandView.visibility = VISIBLE
    val generation = animationGeneration
    bandView.post { animateBand(generation) }
  }

  private fun animateBand(generation: Int) {
    if (generation != animationGeneration || !shouldAnimate()) return
    bandView.translationX = -bandWidthPx
    bandView.animate()
      .translationX(width.toFloat())
      .setDuration(SWEEP_DURATION_MS)
      .setInterpolator(linearInterpolator)
      .withEndAction {
        if (generation == animationGeneration && shouldAnimate()) animateBand(generation)
      }
      .start()
  }

  private fun stopAnimation() {
    animationGeneration += 1
    bandView.animate().cancel()
    bandView.visibility = INVISIBLE
  }

  private fun bandWidthFor(availableWidth: Int): Float =
    max(PixelUtil.toPixelFromDIP(28f), availableWidth * 0.46f)

  private fun fontWeight(): Int = when (pendingFontWeight) {
    "bold" -> 700
    else -> pendingFontWeight?.toIntOrNull() ?: 400
  }

  private fun horizontalStart(text: String): Float {
    val remaining = max(0f, width - ceil(paint.measureText(text)))
    return when (pendingTextAlign) {
      "center" -> remaining / 2f
      "right" -> remaining
      else -> 0f
    }
  }
}

private class GradientBandView(context: Context) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  init {
    setWillNotDraw(false)
  }

  fun configure(widthPx: Float, highlightColor: Int) {
    val transparent = ColorUtils.setAlphaComponent(highlightColor, 0)
    paint.shader = LinearGradient(
      0f,
      0f,
      max(1f, widthPx),
      0f,
      intArrayOf(transparent, transparent, highlightColor, transparent, transparent),
      floatArrayOf(0f, 0.2f, 0.5f, 0.8f, 1f),
      Shader.TileMode.CLAMP,
    )
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
  }
}
