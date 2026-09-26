package dev.codewide.app.rendering

import android.content.Context
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout

/** Owns one interchangeable Voice Assistant renderer and replays its live inputs on replacement. */
class VoiceAssistantOrbSlotView(context: Context) : FrameLayout(context) {
  private var backdropEnabled = false

  fun setBackdropEnabled(enabled: Boolean) {
    backdropEnabled = enabled
    renderer.setBackdropEnabled(enabled)
  }

  private var orbStyle = VoiceAssistantOrbStyle.PARTICLES
  private var orbState = VoiceAssistantOrbState.IDLE
  private var reducedMotion = false
  private var inputLevel = 0.0
  private var microphoneMuted = false
  private var playbackLevel = 0.0
  private var renderer: VoiceAssistantOrbView = createRenderer(orbStyle)

  init {
    // Visual padding may extend beyond the 66dp renderer without resizing its hit geometry.
    clipChildren = false
    clipToPadding = false
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

  fun setAudioLevels(nextInputLevel: Double, nextPlaybackLevel: Double) {
    inputLevel = nextInputLevel
    playbackLevel = nextPlaybackLevel
    renderer.setAudioLevels(nextInputLevel, nextPlaybackLevel)
  }

  fun setInputLevel(nextInputLevel: Double) {
    setAudioLevels(nextInputLevel, playbackLevel)
  }

  fun setPlaybackLevel(nextPlaybackLevel: Double) {
    setAudioLevels(inputLevel, nextPlaybackLevel)
  }

  fun setMicrophoneMuted(muted: Boolean) {
    if (microphoneMuted == muted) return
    microphoneMuted = muted
    if (muted) {
      setLayerType(View.LAYER_TYPE_HARDWARE, MUTED_LAYER_PAINT)
    } else {
      setLayerType(View.LAYER_TYPE_NONE, null)
    }
  }

  fun setReducedMotion(reduced: Boolean) {
    reducedMotion = reduced
    renderer.setReducedMotion(reduced)
  }

  private fun createRenderer(style: VoiceAssistantOrbStyle): VoiceAssistantOrbView =
    VoiceAssistantOrbRendererFactory.create(context, style).also { nextRenderer ->
      nextRenderer.setBackdropEnabled(backdropEnabled)
      nextRenderer.setOrbState(orbState)
      nextRenderer.setAudioLevels(inputLevel, playbackLevel)
      nextRenderer.setReducedMotion(reducedMotion)
    }

  private fun rendererLayoutParams(): LayoutParams =
    LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
      gravity = Gravity.CENTER
    }

  private companion object {
    private val MUTED_LAYER_PAINT = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      alpha = 190
      colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
    }
  }
}
