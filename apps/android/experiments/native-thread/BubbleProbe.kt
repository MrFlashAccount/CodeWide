package dev.codewide.app

import android.app.Activity
import android.graphics.Rect
import android.os.SystemClock
import android.os.Trace
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import com.facebook.react.R
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.ceil
import kotlin.math.floor

/** Both A/B arms sample the same viewport. Catalog and composer text are outside this subtree. */
class TranscriptProbeManager : ReactViewManager() {
  override fun getName() = "CodeWideLabProbe"
  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup =
    object : ReactViewGroup(context) {
      override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        BubbleProbe.targets.add(this)
      }

      override fun onDetachedFromWindow() {
        BubbleProbe.targets.remove(this)
        super.onDetachedFromWindow()
      }
    }
}

/** Release-like lab builds arm the pre-draw scan only for an actual catalog ACTION_DOWN in a trace. */
internal class BubbleProbe(private val activity: Activity) {
  companion object {
    val targets: MutableSet<View> = Collections.newSetFromMap(WeakHashMap())
  }
  private val root get() = activity.window.decorView
  private val box = Rect()
  private val region = Rect()
  private val lineRect = Rect()
  private val bubbles = ArrayList<Rect>()
  private val xy = IntArray(2)
  private val rowTags = setOf("turn-group","codex-bubble","agent-bubble-frame","user-bubble")
  private fun id(view: View) = view.getTag(R.id.react_test_id) as? String
  private fun mark(name: String) { Trace.beginSection(name); Trace.endSection() }

  private fun hitsTitle(view: View, x: Int, y: Int): Boolean {
    if (!view.isShown || view.alpha <= 0 || !view.getGlobalVisibleRect(box) || !box.contains(x,y)) return false
    if (id(view) == "catalog-row-title") return true
    return view is ViewGroup && (0 until view.childCount).any { hitsTitle(view.getChildAt(it),x,y) }
  }

  private fun visibleText(text: TextView): Boolean {
    val layout = text.layout ?: return false
    if (text.text.isNullOrBlank() || !text.getGlobalVisibleRect(box) || !box.intersect(region)) return false
    text.getLocationOnScreen(xy)
    val x = xy[0] + text.totalPaddingLeft - text.scrollX
    val y = xy[1] + text.totalPaddingTop - text.scrollY
    val first = layout.getLineForVertical((box.top-y).coerceAtLeast(0))
    val last = layout.getLineForVertical((box.bottom-1-y).coerceAtLeast(0))
    for (line in first..last) {
      lineRect.set(x+floor(layout.getLineLeft(line)).toInt(), y+layout.getLineTop(line),
        x+ceil(layout.getLineRight(line)).toInt(), y+layout.getLineBottom(line))
      if (layout.getLineEnd(line)>layout.getLineStart(line) && lineRect.intersect(box) &&
          (bubbles.isEmpty() || bubbles.any { Rect.intersects(it,lineRect) })) return true
    }
    return false
  }

  private fun collectBubbles(view: View) {
    if (view.visibility != View.VISIBLE || view.alpha <= .02f) return
    if (id(view) in rowTags && view.getGlobalVisibleRect(box) && box.intersect(region)) bubbles.add(Rect(box))
    if (view is ViewGroup) for (i in 0 until view.childCount) collectBubbles(view.getChildAt(i))
  }

  private fun hasText(view: View): Boolean {
    if (view.visibility != View.VISIBLE || view.alpha <= .02f) return false
    if (view is TextView && visibleText(view)) return true
    return view is ViewGroup && (0 until view.childCount).any { hasText(view.getChildAt(it)) }
  }

  private fun marker(view: View): String? {
    var ancestor: View? = view
    while (ancestor != null) {
      if (ancestor.visibility != View.VISIBLE || ancestor.alpha <= .02f) return null
      ancestor = ancestor.parent as? View
    }
    if (!view.getGlobalVisibleRect(region) || !region.intersect(0,root.height/4,root.width,root.height*3/4)) return null
    val range = id(view) == "lab-probe-range"
    bubbles.clear()
    if (!range) {
      collectBubbles(view)
      if (bubbles.isEmpty()) return null
    }
    if (!hasText(view)) return null
    return if (range) "cw.lab.range.ink" else "cw.bubble.ink"
  }

  fun arm(event: MotionEvent) {
    if (!hitsTitle(root,event.rawX.toInt(),event.rawY.toInt())) return
    mark("cw.catalog.down")
    val until = SystemClock.uptimeMillis() + 5500
    var remaining = 7
    root.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
      override fun onPreDraw(): Boolean {
        if (remaining == 0 || SystemClock.uptimeMillis() >= until) root.viewTreeObserver.removeOnPreDrawListener(this)
        else {
          Trace.beginSection("cw.probe.scan")
          val observed = try { targets.firstNotNullOfOrNull(::marker) } finally { Trace.endSection() }
          if (observed != null) { mark(observed); remaining-- }
        }
        return true
      }
    })
  }
}
