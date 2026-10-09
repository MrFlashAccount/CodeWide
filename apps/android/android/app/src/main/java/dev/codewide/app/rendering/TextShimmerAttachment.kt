package dev.codewide.app.rendering

import android.animation.ValueAnimator
import android.view.View
import android.view.ViewTreeObserver
import android.view.animation.LinearInterpolator
import kotlin.math.roundToInt

/** Stops decoration on detach/invisibility and releases only its own overlay. */
internal class TextShimmerAttachment(private val drawable: TextShimmerDrawable) :
  View.OnAttachStateChangeListener, ViewTreeObserver.OnPreDrawListener, TextShimmerDecoration {
  private val view = drawable.view
  private val animator = ValueAnimator.ofInt(0, TextShimmerDrawable.MAX_LEVEL).apply {
    duration = SWEEP_DURATION_MS
    repeatCount = ValueAnimator.INFINITE
    interpolator = LinearInterpolator()
    addUpdateListener { drawable.level = (it.animatedFraction * TextShimmerDrawable.MAX_LEVEL).roundToInt() }
  }
  private var observer: ViewTreeObserver? = null
  private var released = false

  init {
    view.overlay.add(drawable)
    view.addOnAttachStateChangeListener(this)
    if (view.isAttachedToWindow) observe()
  }

  override fun onViewAttachedToWindow(view: View) { observe() }
  override fun onViewDetachedFromWindow(view: View) { stopObserving(); animator.cancel() }
  override fun onPreDraw(): Boolean {
    drawable.setBounds(0, 0, view.width, view.height)
    val visible = !released && view.isAttachedToWindow && view.isShown && view.alpha > 0 &&
      view.windowVisibility == View.VISIBLE && view.width > 0 && view.height > 0 &&
      ValueAnimator.areAnimatorsEnabled()
    if (visible && !animator.isStarted) animator.start()
    else if (!visible && animator.isStarted) animator.cancel()
    return true
  }

  override fun release() {
    if (released) return
    released = true
    animator.cancel()
    stopObserving()
    view.removeOnAttachStateChangeListener(this)
    view.overlay.remove(drawable)
  }

  private fun observe() {
    stopObserving()
    observer = view.viewTreeObserver.also { it.addOnPreDrawListener(this) }
  }

  private fun stopObserving() {
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = null
  }

  private companion object { const val SWEEP_DURATION_MS = 2_500L }
}
