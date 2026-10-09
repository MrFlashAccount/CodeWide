package dev.codewide.app.rendering

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.view.View
import android.widget.TextView
import com.swmansion.enriched.markdown.spoiler.SpoilerCapable

/** Draws a highlight through the host's actual glyphs, never a second text layout. */
internal class TextShimmerDrawable(val view: View, private val drawGlyphs: (Canvas) -> Unit) : Drawable() {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
  }
  private val matrix = Matrix()
  private var gradient: LinearGradient? = null
  private var gradientWidth = 0

  override fun draw(canvas: Canvas) {
    if (view.width <= 0 || view.height <= 0) return
    val width = view.width.toFloat()
    if (gradientWidth != view.width) {
      gradientWidth = view.width
      gradient = LinearGradient(
        0f, 0f, width * BAND_FRACTION, 0f,
        intArrayOf(SHADE_COLOR, Color.WHITE, SHADE_COLOR),
        floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP,
      )
    }
    matrix.setTranslate(width * ((1f + BAND_FRACTION) * level / MAX_LEVEL - BAND_FRACTION), 0f)
    gradient?.setLocalMatrix(matrix)
    paint.shader = gradient
    val checkpoint = canvas.save()
    canvas.clipRect(0, 0, view.width, view.height)
    val layer = canvas.saveLayer(0f, 0f, width, view.height.toFloat(), null)
    drawGlyphs(canvas)
    canvas.drawRect(0f, 0f, width, view.height.toFloat(), paint)
    canvas.restoreToCount(layer)
    canvas.restoreToCount(checkpoint)
  }

  override fun onLevelChange(level: Int): Boolean { invalidateSelf(); return true }
  override fun setAlpha(alpha: Int) { paint.alpha = alpha }
  override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
  @Deprecated("Drawable opacity is not used for rendering")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

  companion object {
    const val MAX_LEVEL = 10_000
    private const val BAND_FRACTION = 0.4f
    // A white band alone disappears on near-white product text. Shade only
    // the glyph mask outside the band; the host's paint and layout stay intact.
    private val SHADE_COLOR = Color.argb(107, 0, 0, 0)
  }
}

/** Adapts supported native renderers without reconstructing any of their metrics. */
internal fun textShimmerDrawable(view: View): TextShimmerDrawable? {
  // AnimatedNumber's invisible measuring TextView is not a rendered glyph owner.
  if (view.alpha == 0f) return null
  return when (view) {
    is AnimatedNumberView -> TextShimmerDrawable(view, view::drawGlyphs)
    is TextView -> TextShimmerDrawable(view) { canvas -> drawTextGlyphs(view, canvas) }
    else -> null
  }
}

private fun drawTextGlyphs(view: TextView, canvas: Canvas) {
  // Markdown spoiler masking happens after its Layout draw. Never draw over it.
  if (view is SpoilerCapable && view.spoilerOverlayDrawer != null) return
  val layout = view.layout ?: return
  val checkpoint = canvas.save()
  canvas.translate((view.totalPaddingLeft - view.scrollX).toFloat(), (view.totalPaddingTop - view.scrollY).toFloat())
  // Use the same shaped Layout, not another StaticLayout or mutated TextPaint.
  // The application minSdk is 34: drawText excludes selection/background layers.
  layout.drawText(canvas)
  canvas.restoreToCount(checkpoint)
}
