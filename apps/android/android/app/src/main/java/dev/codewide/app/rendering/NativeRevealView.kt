package dev.codewide.app.rendering

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.view.View
import android.view.animation.PathInterpolator
import com.facebook.react.views.view.ReactViewGroup

/** GPU reveal for an already rendered React Native subtree. */
class NativeRevealView(context: Context) : ReactViewGroup(context) {
  private var pendingReady = true
  private var pendingReduceMotion = false
  private var pendingRevealKey = ""
  private var committedReady = false
  private var committedRevealKey: String? = null
  private var restartWhenSized = false
  private var effectApplied = false
  private var animator: ValueAnimator? = null
  private var shader: RuntimeShader? = null

  fun setPendingReady(value: Boolean) { pendingReady = value }
  fun setPendingReduceMotion(value: Boolean) { pendingReduceMotion = value }
  fun setPendingRevealKey(value: String?) { pendingRevealKey = value ?: "" }

  fun commitProps() {
    val keyChanged = committedRevealKey != pendingRevealKey
    val becameReady = !committedReady && pendingReady
    committedReady = pendingReady
    committedRevealKey = pendingRevealKey

    if (!pendingReady) {
      restartWhenSized = false
      cancelAnimator()
      applyProgress(0f)
      return
    }
    if (pendingReduceMotion || !ValueAnimator.areAnimatorsEnabled()) {
      finishReveal()
      return
    }
    if (keyChanged || becameReady) startRevealWhenPossible()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!committedReady) {
      applyProgress(0f)
      return
    }
    if (committedReady && committedRevealKey !== null && animator === null && effectApplied) {
      startRevealWhenPossible()
    }
  }

  override fun onDetachedFromWindow() {
    cancelAnimator()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (!committedReady && w > 0 && h > 0) {
      applyProgress(0f)
      return
    }
    if (restartWhenSized && w > 0 && h > 0) startReveal()
  }

  fun release() {
    cancelAnimator()
    setRenderEffect(null)
    effectApplied = false
    shader = null
  }

  private fun startRevealWhenPossible() {
    if (!isAttachedToWindow || width <= 0 || height <= 0) {
      restartWhenSized = true
      applyProgress(0f)
      return
    }
    startReveal()
  }

  private fun startReveal() {
    restartWhenSized = false
    cancelAnimator()
    applyProgress(0f)
    val next = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = REVEAL_DURATION_MS
      interpolator = REVEAL_INTERPOLATOR
      addUpdateListener { applyProgress(it.animatedValue as Float) }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          if (animator === animation) finishReveal()
        }
      })
    }
    animator = next
    next.start()
  }

  private fun finishReveal() {
    restartWhenSized = false
    animator = null
    setRenderEffect(null)
    effectApplied = false
    invalidate()
  }

  private fun cancelAnimator() {
    val running = animator
    animator = null
    running?.cancel()
  }

  private fun applyProgress(progress: Float) {
    if (width <= 0 || height <= 0) return
    val runtimeShader = shader ?: RuntimeShader(SHADER_SOURCE).also { shader = it }
    runtimeShader.setFloatUniform("resolution", width.toFloat(), height.toFloat())
    runtimeShader.setFloatUniform("progress", progress.coerceIn(0f, 1f))
    setRenderEffect(RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents"))
    effectApplied = true
    invalidate()
  }

  private companion object {
    const val REVEAL_DURATION_MS = 420L
    val REVEAL_INTERPOLATOR = PathInterpolator(0.2f, 0.72f, 0.2f, 1f)

    const val SHADER_SOURCE = """
      uniform shader contents;
      uniform float2 resolution;
      uniform float progress;

      float hash21(float2 point) {
        point = fract(point * float2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      half4 main(float2 position) {
        half4 color = contents.eval(position);
        float2 uv = position / max(resolution, float2(1.0));
        float grain = hash21(floor(position / 3.0)) - 0.5;
        float axis = uv.x * 0.82 + uv.y * 0.18;
        float front = progress * 1.24 - 0.14 + grain * 0.07;
        float mask = 1.0 - smoothstep(front, front + 0.105, axis);
        return color * half(mask);
      }
    """
  }
}
