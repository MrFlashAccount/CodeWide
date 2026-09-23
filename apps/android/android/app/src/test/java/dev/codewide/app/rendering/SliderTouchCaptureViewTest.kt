package dev.codewide.app.rendering

import android.app.Activity
import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.uimanager.RootView
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class SliderTouchCaptureViewTest {
  @Test
  fun captureSkipsIntermediateGestureRootAndReleasesAfterLift() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val menuRoot = RecordingRoot(activity)
    val gestureRoot = RecordingParent(activity)
    val capture = SliderTouchCaptureView(activity)
    activity.setContentView(menuRoot)
    menuRoot.addView(gestureRoot)
    gestureRoot.addView(capture)

    dispatch(capture, MotionEvent.ACTION_DOWN)
    dispatch(capture, MotionEvent.ACTION_MOVE, x = 1_000f)
    assertEquals(listOf(true), menuRoot.requests)
    assertEquals(emptyList<Boolean>(), gestureRoot.requests)

    dispatch(capture, MotionEvent.ACTION_UP)
    assertEquals(listOf(true, false), menuRoot.requests)
    assertEquals(emptyList<Boolean>(), gestureRoot.requests)
  }

  @Test
  fun cancelAlsoReleasesCapture() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val menuRoot = RecordingRoot(activity)
    val capture = SliderTouchCaptureView(activity)
    activity.setContentView(menuRoot)
    menuRoot.addView(capture)

    dispatch(capture, MotionEvent.ACTION_DOWN)
    dispatch(capture, MotionEvent.ACTION_CANCEL)
    assertEquals(listOf(true, false), menuRoot.requests)
  }

  private fun dispatch(view: View, action: Int, x: Float = 10f) {
    val event = MotionEvent.obtain(0L, 16L, action, x, 10f, 0)
    try {
      view.dispatchTouchEvent(event)
    } finally {
      event.recycle()
    }
  }

  private class RecordingParent(context: Context) : FrameLayout(context) {
    val requests = mutableListOf<Boolean>()

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
      requests.add(disallowIntercept)
      super.requestDisallowInterceptTouchEvent(disallowIntercept)
    }
  }

  private class RecordingRoot(context: Context) : FrameLayout(context), RootView {
    val requests = mutableListOf<Boolean>()

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
      requests.add(disallowIntercept)
    }

    override fun onChildStartedNativeGesture(childView: View?, ev: MotionEvent) = Unit
    override fun onChildEndedNativeGesture(childView: View, ev: MotionEvent) = Unit
    override fun handleException(t: Throwable) = throw t
  }
}
