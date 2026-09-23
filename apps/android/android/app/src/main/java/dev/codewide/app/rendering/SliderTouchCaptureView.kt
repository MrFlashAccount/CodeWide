package dev.codewide.app.rendering

import android.content.Context
import android.view.MotionEvent
import android.view.ViewParent
import com.facebook.react.uimanager.RootView
import com.facebook.react.views.view.ReactViewGroup

/** Keeps the Compose menu from intercepting a slider drag after the finger leaves the track. */
class SliderTouchCaptureView(context: Context) : ReactViewGroup(context) {
  private var captureRoot: ViewParent? = null

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      releaseCapture()
      captureRoot = findMenuRoot()
      // Bypass RNGestureHandlerRootView: its interception hook cancels active pan handlers.
      // RNHostView's RootView forwards this request to its Compose parent without suppressing
      // its own JS touch dispatcher.
      captureRoot?.requestDisallowInterceptTouchEvent(true)
    }

    return try {
      super.dispatchTouchEvent(event)
    } finally {
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
        releaseCapture()
      }
    }
  }

  override fun onDetachedFromWindow() {
    releaseCapture()
    super.onDetachedFromWindow()
  }

  private fun findMenuRoot(): ViewParent? {
    var ancestor = parent
    while (ancestor != null) {
      if (ancestor is RootView) return ancestor
      ancestor = ancestor.parent
    }
    return null
  }

  private fun releaseCapture() {
    captureRoot?.requestDisallowInterceptTouchEvent(false)
    captureRoot = null
  }
}
