package dev.codewide.app.input

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

/** Draws the local cursor without publishing per-frame coordinates to JavaScript. */
internal class DesktopInputCursor(private val density: Float) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val path = Path()

  fun draw(canvas: Canvas, x: Float, y: Float) {
    val unit = density
    path.reset()
    path.moveTo(x, y)
    path.lineTo(x + 4f * unit, y + 20f * unit)
    path.lineTo(x + 8f * unit, y + 14f * unit)
    path.lineTo(x + 16f * unit, y + 14f * unit)
    path.close()
    paint.style = Paint.Style.FILL
    paint.color = Color.WHITE
    canvas.drawPath(path, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = unit * 1.5f
    paint.color = Color.BLACK
    canvas.drawPath(path, paint)
  }
}
