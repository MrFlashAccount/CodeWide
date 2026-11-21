package dev.codewide.app.rendering

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.text.Layout
import android.text.style.LeadingMarginSpan
import android.text.style.LineHeightSpan

internal class ListMarker(
  private val label: String,
  private val inset: Int,
  private val gap: Int,
  private val iconSize: Int,
  private val color: Int,
) : LeadingMarginSpan {
  private val marker = Paint()
  private val check = Path()

  override fun getLeadingMargin(first: Boolean) = inset

  override fun drawLeadingMargin(canvas: Canvas, paint: Paint, x: Int, dir: Int,
    top: Int, baseline: Int, bottom: Int, text: CharSequence, start: Int, end: Int,
    first: Boolean, layout: Layout?) {
    if (!first) return
    marker.apply {
      set(paint)
      this.color = this@ListMarker.color
      textAlign = if (dir > 0) Paint.Align.RIGHT else Paint.Align.LEFT
    }
    val edge = (x + dir * (inset - gap)).toFloat()
    if (label != "checked" && label != "unchecked") {
      canvas.drawText(label, edge, baseline.toFloat(), marker)
      return
    }
    val size = iconSize * .84f
    val left = if (dir > 0) edge - size else edge
    val center = baseline + (paint.ascent() + paint.descent()) / 2
    val y = center - size / 2
    marker.style = Paint.Style.STROKE
    marker.strokeWidth = size * .1f
    marker.strokeJoin = Paint.Join.ROUND
    canvas.drawRoundRect(left, y, left + size, y + size, size * .12f, size * .12f, marker)
    if (label == "checked") {
      check.apply {
        reset()
        moveTo(left + size * .18f, y + size * .52f)
        lineTo(left + size * .42f, y + size * .74f)
        lineTo(left + size * .82f, y + size * .24f)
      }
      canvas.drawPath(check, marker)
    }
  }
}

internal class ListLineHeight(private val height: Int, private val gap: Int, private val endOffset: Int) : LineHeightSpan {
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, v: Int, fm: Paint.FontMetricsInt) {
    val extra = height - (fm.descent - fm.ascent)
    fm.ascent -= extra / 2
    fm.descent += extra - extra / 2
    if (end >= endOffset) fm.descent += gap
    fm.top = fm.ascent
    fm.bottom = fm.descent
  }
}
