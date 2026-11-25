package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Canvas
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewTreeObserver
import android.widget.ScrollView
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

/** Keeps a bottom-pinned transcript attached to its resizing viewport before Android draws it. */
internal class TimelineScrollHost(context: Context) : ReactViewGroup(context), PaneReflowContent {
  private val reflowRows = TimelineReflowRows(this)
  private var pane: PaneSnapshotView? = null
  override val displayedWidth: Int get() = width
  override fun isReadyAt(width: Int) = reflowRows.ready(width)

  var endThresholdRatio: Float = 0f

  private val widthAnchor = TimelineWidthAnchor()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var downX = 0f
  private var downY = 0f
  private val beforeDraw = ViewTreeObserver.OnPreDrawListener {
    adjustBeforeDraw()
    true
  }

  fun setPaneMoving(value: Boolean) {
    if (value) {
      val wasActive = widthAnchor.active
      (getChildAt(0) as? ScrollView)?.let { widthAnchor.begin(it, endThresholdRatio) }
      if (!wasActive && widthAnchor.active) viewTreeObserver.addOnPreDrawListener(beforeDraw)
      if (wasActive && !widthAnchor.active) viewTreeObserver.removeOnPreDrawListener(beforeDraw)
    } else if (widthAnchor.active) {
      widthAnchor.settle()
      postInvalidateDelayed(TimelineWidthAnchor.SETTLE_MS)
    }
  }

  private fun releaseAnchor() {
    if (widthAnchor.active) viewTreeObserver.removeOnPreDrawListener(beforeDraw)
    widthAnchor.release()
  }

  private fun adjustBeforeDraw() {
    if (widthAnchor.active) {
      widthAnchor.beforeDraw()
      if (!widthAnchor.active) viewTreeObserver.removeOnPreDrawListener(beforeDraw)
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    adjustBeforeDraw()
    super.dispatchDraw(canvas)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    var ancestor = parent
    while (ancestor != null && ancestor !is PaneSnapshotView) ancestor = ancestor.parent
    pane = ancestor as? PaneSnapshotView
    pane?.reflowContent = this
  }

  override fun onDetachedFromWindow() {
    pane?.let { if (it.reflowContent === this) it.reflowContent = null }
    pane = null
    releaseAnchor()
    super.onDetachedFromWindow()
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
      }
      MotionEvent.ACTION_MOVE -> if (widthAnchor.active) {
        val dy = kotlin.math.abs(event.y - downY)
        if (dy > touchSlop && dy > kotlin.math.abs(event.x - downX)) {
          viewTreeObserver.removeOnPreDrawListener(beforeDraw)
          widthAnchor.finish()
        }
      }
    }
    return super.dispatchTouchEvent(event)
  }

  private val followResize = OnLayoutChangeListener { child, _, top, _, bottom, _, oldTop, _, oldBottom ->
    val scroll = child as ScrollView
    val oldHeight = oldBottom - oldTop
    val height = bottom - top
    // On growth Android already clamps scrollY to the new end. On shrink it preserves the old
    // offset, leaving a pinned transcript behind the composer until a later JS layout callback.
    if (height in 1 until oldHeight) {
      val content = scroll.getChildAt(0) ?: return@OnLayoutChangeListener
      val contentEnd = content.bottom + scroll.paddingBottom
      if (contentEnd - oldHeight - scroll.scrollY <= oldHeight * endThresholdRatio) {
        scroll.scrollTo(scroll.scrollX, (contentEnd - height).coerceAtLeast(0))
      }
    }
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is ScrollView) {
      child.addOnLayoutChangeListener(followResize)
      child.setOnScrollChangeListener { _, _, _, _, _ -> widthAnchor.follow() }
    }
  }

  override fun onViewRemoved(child: View) {
    if (child is ScrollView) child.setOnScrollChangeListener(null)
    child.removeOnLayoutChangeListener(followResize)
    super.onViewRemoved(child)
  }
}

class TimelineScrollHostManager : ReactViewManager() {
  override fun getName(): String = "CodeWideTimelineScrollHost"
  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup = TimelineScrollHost(context)

  @ReactProp(name = "paneMoving", defaultBoolean = false)
  fun setPaneMoving(view: ReactViewGroup, value: Boolean) {
    require(view is TimelineScrollHost)
    view.setPaneMoving(value)
  }

  @ReactProp(name = "endThresholdRatio", defaultFloat = 0f)
  fun setEndThresholdRatio(view: ReactViewGroup, value: Float) {
    require(view is TimelineScrollHost)
    view.endThresholdRatio = value
  }
}
