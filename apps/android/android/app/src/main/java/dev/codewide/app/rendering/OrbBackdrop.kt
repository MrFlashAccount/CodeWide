package dev.codewide.app.rendering

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import kotlin.math.exp

/** Local contrast floor; the feather leaves the system window and particle depth transparent. */
internal object VoiceOverlayContrast {
  const val CORE_COLOR = 0xE0121420.toInt()
  const val CORE_RADIUS = 0.78f

  fun alphaAt(radiusFraction: Float): Float {
    val coreAlpha = (CORE_COLOR ushr 24) / 255f
    return coreAlpha * ((1f - radiusFraction) / (1f - CORE_RADIUS)).coerceIn(0f, 1f)
  }
}

/** Visual bounds only: no View, hit area or WindowManager geometry participates. */
internal class OrbBackdropRadius {
  var value = 0f
    private set

  fun update(visualRadius: Float, padding: Float, deltaSeconds: Float, snap: Boolean): Float {
    val target = (visualRadius + padding).coerceAtLeast(0f)
    value = if (snap || value == 0f) target else
      value + (target - value) * (1f - exp(-deltaSeconds.coerceAtLeast(0f) / 0.18f))
    return value
  }
}

/** Unit gradient is scaled on Canvas; changing the radius never allocates a shader. */
internal class OrbBackdrop {
  private val radius = OrbBackdropRadius()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    shader = RadialGradient(
      0f, 0f, 1f,
      intArrayOf(VoiceOverlayContrast.CORE_COLOR, VoiceOverlayContrast.CORE_COLOR, 0x00121420),
      floatArrayOf(0f, VoiceOverlayContrast.CORE_RADIUS, 1f), Shader.TileMode.CLAMP,
    )
  }

  fun draw(canvas: Canvas, centerX: Float, centerY: Float, visualRadius: Float,
    padding: Float, deltaSeconds: Float, snap: Boolean) {
    val size = radius.update(visualRadius, padding, deltaSeconds, snap)
    if (size <= 0f) return
    val save = canvas.save()
    canvas.translate(centerX, centerY)
    canvas.scale(size, size)
    canvas.drawCircle(0f, 0f, 1f, paint)
    canvas.restoreToCount(save)
  }
}
