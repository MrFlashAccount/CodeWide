package dev.codewide.app.rendering

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Rect
import android.view.animation.PathInterpolator
import com.facebook.react.views.view.ReactViewGroup
import kotlin.math.roundToInt

/** Never feeds animation measurements back into Yoga or the list's scroll geometry. */
class NativeFluidLayoutView(context: Context) : ReactViewGroup(context) {
  private var enabled = false
  private var previousTop = 0
  private var previousWidth = 0
  private var previousHeight = 0
  private var animator: ValueAnimator? = null
  private val clip = Rect()

  fun setAnimate(value: Boolean) {
    if (value && !enabled) {
      // Resume from a fresh Yoga frame, not geometry retained across scrolling or recycling.
      previousWidth = 0
      previousHeight = 0
    }
    enabled = value
    if (!value) finish()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    val start = fluidLayoutStart(previousTop, top, previousHeight, translationY, clipBounds?.height())
    val canAnimate = enabled && isAttachedToWindow && ValueAnimator.areAnimatorsEnabled() &&
      previousWidth == width && previousHeight > 0 && height > 0
    val moved = previousTop != top || previousHeight != height
    previousTop = top
    previousWidth = width
    previousHeight = height
    if (!canAnimate) { finish(); return }
    if (!moved) return
    cancelAnimator()
    applyFrame(start.translation, start.visibleHeight)
    val targetHeight = height.toFloat()
    val next = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 200L
      interpolator = PathInterpolator(0.2f, 0.72f, 0.2f, 1f)
      addUpdateListener {
        val progress = it.animatedFraction
        applyFrame(start.translation * (1f - progress), start.visibleHeight + (targetHeight - start.visibleHeight) * progress)
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) { if (animator === animation) finish() }
      })
    }
    animator = next
    next.start()
  }

  private fun applyFrame(translation: Float, visibleHeight: Float) {
    translationY = translation
    clip.set(0, 0, width, visibleHeight.roundToInt().coerceAtLeast(0))
    clipBounds = clip
  }

  private fun cancelAnimator() {
    val running = animator
    animator = null
    running?.cancel()
  }

  fun finish() {
    cancelAnimator()
    translationY = 0f
    clipBounds = null
  }

  override fun onDetachedFromWindow() {
    finish()
    previousWidth = 0
    previousHeight = 0
    super.onDetachedFromWindow()
  }
}
