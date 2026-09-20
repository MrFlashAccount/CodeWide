package dev.codewide.app.rendering

import android.content.Context
import android.view.Gravity
import android.widget.FrameLayout

/** Owns one interchangeable Voice Assistant renderer and replays its live inputs on replacement. */
class VoiceAssistantOrbSlotView(context: Context) : FrameLayout(context) {
  private var orbStyle = VoiceAssistantOrbStyle.NEBULA
  private var orbState = VoiceAssistantOrbState.IDLE
  private var reducedMotion = false
  private var level = -1.0
  private var renderer: VoiceAssistantOrbView = createRenderer(orbStyle)

  init {
    addView(renderer, rendererLayoutParams())
  }

  fun setOrbStyle(style: VoiceAssistantOrbStyle) {
    if (orbStyle == style) return
    val previous = renderer
    removeView(previous)
    orbStyle = style
    renderer = createRenderer(style)
    addView(renderer, rendererLayoutParams())
  }

  fun setOrbState(state: VoiceAssistantOrbState) {
    orbState = state
    renderer.setOrbState(state)
  }

  fun setLevel(nextLevel: Double) {
    level = nextLevel
    renderer.setLevel(nextLevel)
  }

  fun setReducedMotion(reduced: Boolean) {
    reducedMotion = reduced
    renderer.setReducedMotion(reduced)
  }

  private fun createRenderer(style: VoiceAssistantOrbStyle): VoiceAssistantOrbView =
    VoiceAssistantOrbRendererFactory.create(context, style).also { nextRenderer ->
      nextRenderer.setOrbState(orbState)
      nextRenderer.setLevel(level)
      nextRenderer.setReducedMotion(reducedMotion)
    }

  private fun rendererLayoutParams(): LayoutParams =
    LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
      gravity = Gravity.CENTER
    }
}
