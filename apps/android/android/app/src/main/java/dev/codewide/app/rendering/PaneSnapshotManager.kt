package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.os.Trace
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import androidx.core.widget.NestedScrollView
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

/** Holds a drawing of the outgoing body only until the new child width has been drawn. */
class PaneSnapshotManager : ReactViewManager() {
  override fun getName() = "CodeWidePaneSnapshot"
  override fun createViewInstance(context: ThemedReactContext) = PaneSnapshotView(context)

  @ReactProp(name = "canvasColor", customType = "Color")
  fun setCanvasColor(view: ReactViewGroup, color: Int) {
    if (view is PaneSnapshotView) view.canvasColor = color
  }

  @ReactProp(name = "keepScrollEnd")
  fun setKeepScrollEnd(view: ReactViewGroup, enabled: Boolean) {
    if (view is PaneSnapshotView) view.keepScrollEnd = enabled
  }

  override fun receiveCommand(root: ReactViewGroup, commandId: String, args: ReadableArray?) {
    if (root is PaneSnapshotView && commandId == "capture") {
      root.capture()
    } else {
      super.receiveCommand(root, commandId, args)
    }
  }

  override fun onDropViewInstance(view: ReactViewGroup) {
    if (view is PaneSnapshotView) view.clearSnapshot()
    super.onDropViewInstance(view)
  }
}

class PaneSnapshotView(context: Context) : ReactViewGroup(context) {
  var canvasColor: Int = 0
  var keepScrollEnd = false
  private var pinnedScroll: ViewGroup? = null
  private val paint = Paint()
  private val area = Rect()
  private var leftEdge = 0
  private var topEdge = 0
  private var oldWidth = 0
  private var image: Bitmap? = null
  private var fadeStart = 0L
  private val expire = Runnable { clearSnapshot() }

  fun capture() {
    val child = getChildAt(0) ?: return
    if (findFocus()?.onCheckIsTextEditor() == true || !isShown || !isAttachedToWindow ||
      !getLocalVisibleRect(area) || child.width <= 0 || area.width().toLong() * area.height() > MAX_PIXELS
    ) {
      clearSnapshot()
      return
    }
    Trace.beginSection("PaneSnapshot.capture")
    try {
      captureVisible(child.width)
    } finally {
      Trace.endSection()
    }
  }

  private fun captureVisible(childWidth: Int) {
    val captured = Bitmap.createBitmap(area.width(), area.height(), Bitmap.Config.ARGB_8888)
    captured.density = Bitmap.DENSITY_NONE
    captured.eraseColor(canvasColor)
    val canvas = Canvas(captured)
    canvas.translate(-area.left.toFloat(), -area.top.toFloat())
    // draw includes any outgoing layer already on screen when a transition is reversed.
    try {
      draw(canvas)
    } catch (_: IllegalArgumentException) {
      // A hardware-only bitmap in a child cannot be drawn into a software canvas.
      clearSnapshot()
      return
    } catch (_: IllegalStateException) {
      // Hardware-only drawing commands are unsupported on a bitmap canvas.
      clearSnapshot()
      return
    }
    clearSnapshot()
    // The PR overview contains one vertical reading ScrollView. Lists own their anchors.
    if (keepScrollEnd) {
      pinnedScroll = findReadingScroll(this)?.takeIf { it.scrollY > 0 && !it.canScrollVertically(1) }
    }
    image = captured
    leftEdge = area.left
    topEdge = area.top
    oldWidth = childWidth
    fadeStart = 0L
    // An unchanged width, aborted navigation, or hidden pane must release the drawing too.
    postDelayed(expire, EXPIRY_MS)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val scroll = pinnedScroll
    if (scroll != null && scroll.isAttachedToWindow && getChildAt(0)?.width != oldWidth) {
      // The platform clamps to the shorter page. Follow its new end when the page grows back.
      scroll.scrollTo(scroll.scrollX, scroll.getChildAt(0)?.height ?: 0)
      pinnedScroll = null
    }
    super.dispatchDraw(canvas)
    val snapshot = image ?: return
    val now = SystemClock.uptimeMillis()
    if (fadeStart == 0L) {
      if (getChildAt(0)?.width == oldWidth) return
      Trace.beginSection("PaneSnapshot.reveal")
      fadeStart = now
      Trace.endSection()
    }
    val elapsed = now - fadeStart
    if (elapsed >= FADE_MS) {
      clearSnapshot()
      return
    }
    paint.alpha = ((FADE_MS - elapsed) * 255L / FADE_MS).toInt()
    canvas.drawBitmap(snapshot, leftEdge.toFloat(), topEdge.toFloat(), paint)
    postInvalidateOnAnimation()
  }

  fun clearSnapshot() {
    pinnedScroll = null
    removeCallbacks(expire)
    if (image != null) {
      image = null
      invalidate()
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) pinnedScroll = null
    return super.dispatchTouchEvent(event)
  }

  private fun findReadingScroll(view: View): ViewGroup? {
    if (view is ScrollView) return view
    if (view is NestedScrollView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findReadingScroll(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  override fun onDetachedFromWindow() {
    clearSnapshot()
    super.onDetachedFromWindow()
  }

  private companion object {
    const val MAX_PIXELS = 4_000_000L
    const val FADE_MS = 110L
    const val EXPIRY_MS = 600L
  }
}
