package dev.codewide.app.rendering

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView

/** Keeps a mounted row at its reading offset while the virtualizer commits heights and positions separately. */
internal class TimelineWidthAnchor {
  private val location = IntArray(2)
  private var row: View? = null
  private var scroll: ScrollView? = null
  private var atEnd = false
  private var offset = 0
  private var anchorWidth = 0
  private var resized = false
  private var following = false
  private var settlingUntil: Long? = null

  private fun position(view: View): Int {
    view.getLocationInWindow(location)
    return location[1]
  }

  val active: Boolean get() = row != null

  fun begin(view: ScrollView, threshold: Float) {
    if (scroll === view && row?.isAttachedToWindow == true) {
      settlingUntil = null
      return
    }
    release()
    val content = view.getChildAt(0) ?: return
    val top = position(view)
    val bottom = top + view.height
    atEnd = content.bottom + view.paddingBottom - view.scrollY - view.height <= view.height * threshold
    // Row roots remain mounted with one item identity. Never anchor to a recycled container.
    var best: View? = null
    var bestEdge = if (atEnd) Int.MIN_VALUE else Int.MAX_VALUE
    fun visit(child: View) {
      if (!child.isShown) return
      if (child.isTimelineReadingRow()) {
        val start = position(child)
        val end = start + child.height
        if (start < bottom && end > top && (if (atEnd) end > bestEdge else start < bestEdge)) {
          best = child
          bestEdge = if (atEnd) end else start
        }
      } else if (child is ViewGroup) {
        for (index in 0 until child.childCount) visit(child.getChildAt(index))
      }
    }
    visit(content)
    val visibleRow = best ?: return
    // A virtual row and its contents can receive their new heights in different Fabric commits.
    // Follow the visible content itself, even in a row that spans several screens.
    val reading = readingLeaf(visibleRow, top, bottom)
    row = reading
    scroll = view
    anchorWidth = view.width
    resized = false
    offset = position(reading) - top + if (atEnd) reading.height else 0
  }

  private fun readingLeaf(view: View, top: Int, bottom: Int): View {
    if (view !is ViewGroup) return view
    var best: View? = null
    var bestEdge = if (atEnd) Int.MIN_VALUE else Int.MAX_VALUE
    for (index in 0 until view.childCount) {
      val child = view.getChildAt(index)
      if (child.visibility != View.VISIBLE || child.height <= 0 || child.width <= 0) continue
      val start = position(child)
      val end = start + child.height
      if (start < bottom && end > top && (if (atEnd) end > bestEdge else start < bestEdge)) {
        best = child
        bestEdge = if (atEnd) end else start
      }
    }
    return best?.let { readingLeaf(it, top, bottom) } ?: view
  }

  fun settle() {
    if (row != null) settlingUntil = SystemClock.uptimeMillis() + SETTLE_MS
  }

  fun follow() {
    val anchor = row ?: return
    val view = scroll ?: return
    val content = view.getChildAt(0) ?: return
    if (following || !anchor.isAttachedToWindow) return
    resized = resized || anchorWidth != view.width
    if (!resized) return
    val edge = position(anchor) - position(view) + if (atEnd) anchor.height else 0
    val intended = view.scrollY - content.translationY.toInt() + edge - offset
    val maxScroll = (content.height + view.paddingTop + view.paddingBottom - view.height).coerceAtLeast(0)
    val physical = intended.coerceIn(0, maxScroll)
    // Prefer the ScrollView's own pixels. Only a not-yet-measured tail needs an offset
    // beyond its current scroll range. Reconcile both in the same draw.
    following = true
    try {
      if (view.scrollY != physical) view.scrollTo(view.scrollX, physical)
      // Rounding the virtual tail to the physical pixel grid can leave a single pixel
      // outside the scroll range. Keeping it translated would nudge the text after handoff.
      val overflow = view.scrollY - intended
      val residual = if (atEnd && kotlin.math.abs(overflow) <= 1) 0f else overflow.toFloat()
      if (content.translationY != residual) {
        content.translationY = residual
        content.invalidate()
        view.invalidate()
      }
    } finally {
      following = false
    }
  }

  fun beforeDraw() {
    val anchor = row ?: return
    val view = scroll ?: return
    val content = view.getChildAt(0)
    if (content == null || !anchor.isAttachedToWindow) {
      release()
      return
    }
    follow()
    val until = settlingUntil
    if (until != null && SystemClock.uptimeMillis() >= until) {
      finish()
    }
  }

  /** Hand off the visible position to normal scrolling without dropping a pending correction. */
  fun finish() {
    val view = scroll ?: return
    val y = view.scrollY - (view.getChildAt(0)?.translationY ?: 0f).toInt()
    release()
    view.scrollTo(view.scrollX, y)
  }

  fun release() {
    scroll?.getChildAt(0)?.let { if (it.translationY != 0f) it.translationY = 0f }
    scroll = null
    row = null
    settlingUntil = null
  }

  companion object {
    const val SETTLE_MS = 350L
  }
}
