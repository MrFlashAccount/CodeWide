package dev.codewide.app.rendering

import android.content.Context
import android.view.View
import android.widget.ScrollView
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

/** Keeps a bottom-pinned transcript attached to its resizing viewport before Android draws it. */
class TimelineScrollHost(context: Context) : ReactViewGroup(context) {
  var endThresholdRatio: Float = 0f

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
    if (child is ScrollView) child.addOnLayoutChangeListener(followResize)
  }

  override fun onViewRemoved(child: View) {
    child.removeOnLayoutChangeListener(followResize)
    super.onViewRemoved(child)
  }
}

class TimelineScrollHostManager : ReactViewManager() {
  override fun getName(): String = "CodeWideTimelineScrollHost"
  override fun createViewInstance(context: ThemedReactContext) = TimelineScrollHost(context)

  @ReactProp(name = "endThresholdRatio", defaultFloat = 0f)
  fun setEndThresholdRatio(view: ReactViewGroup, value: Float) {
    require(view is TimelineScrollHost)
    view.endThresholdRatio = value
  }
}
