package dev.codewide.app.rendering

import android.view.View
import android.view.ViewGroup
import com.facebook.react.R
import kotlin.math.abs

/** The list positions adjacent row roots edge to edge; spacing belongs inside each row. */
internal fun View.isTimelineReadingRow(): Boolean =
  (getTag(R.id.view_tag_native_id) as? String)?.startsWith("codewide-reading-row:") == true

/** Used only during the handoff to the resized transcript, never while scrolling or dragging. */
internal class TimelineReflowRows(private val host: TimelineScrollHost) {
  private val position = IntArray(2)
  private val visible = ArrayList<IntRange>()

  fun ready(width: Int): Boolean {
    if (abs(host.width - width) > 1 || host.isLayoutRequested) return false
    host.getLocationInWindow(position)
    val top = position[1]
    visible.clear()
    collect(host, top, top + host.height)
    if (visible.isEmpty()) return false
    visible.sortBy { it.first }
    for (index in 1 until visible.size) {
      // Fabric publishes remeasured heights and LegendList publishes offsets separately.
      if (abs(visible[index].first - (visible[index - 1].last + 1)) > 1) return false
    }
    return true
  }

  private fun collect(view: View, top: Int, bottom: Int) {
    if (view.visibility != View.VISIBLE) return
    if (view.isTimelineReadingRow()) {
      view.getLocationInWindow(position)
      val start = position[1]
      val end = start + view.height
      if (end > top && start < bottom && end > start) visible.add(start until end)
    } else if (view is ViewGroup) {
      for (index in 0 until view.childCount) collect(view.getChildAt(index), top, bottom)
    }
  }
}
