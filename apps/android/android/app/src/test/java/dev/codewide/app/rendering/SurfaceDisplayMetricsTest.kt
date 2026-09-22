package dev.codewide.app.rendering

import android.app.Activity
import android.content.Context
import android.util.DisplayMetrics
import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class SurfaceDisplayMetricsTest {
  private val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
  private val activity = controller.get()
  private val owner = SurfaceDisplayMetrics()

  @After
  fun tearDown() {
    owner.dispose()
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
    DisplayMetricsHolder.setWindowDisplayMetrics(null)
    controller.pause().stop().destroy()
  }

  @Test
  fun repairsLaterReactWritesAndConvergesWithoutALayoutLoop() {
    val surface = CountingView(activity)
    activity.setContentView(surface)
    assertTrue(surface.isAttachedToWindow)
    var reactRotationPending = false
    val reactListener = ViewTreeObserver.OnGlobalLayoutListener {
      if (reactRotationPending) {
        reactRotationPending = false
        writeWrongDensity()
      }
    }
    surface.viewTreeObserver.addOnGlobalLayoutListener(reactListener)
    owner.bind(surface)
    val baseline = surface.layoutRequests
    reactRotationPending = true
    surface.viewTreeObserver.dispatchOnGlobalLayout()
    assertCorrectDensity()
    assertEquals(baseline + 1, surface.layoutRequests)
    surface.viewTreeObserver.dispatchOnGlobalLayout()
    assertEquals(baseline + 1, surface.layoutRequests)

    owner.dispose()
    reactRotationPending = true
    surface.viewTreeObserver.dispatchOnGlobalLayout()
    assertEquals(9f, DisplayMetricsHolder.getScreenDisplayMetrics().density, 0f)
    assertEquals(baseline + 1, surface.layoutRequests)
    surface.viewTreeObserver.removeOnGlobalLayoutListener(reactListener)
  }

  @Test
  fun correctsBeforeAttachmentAndResubscribesWhenTheSurfaceReturns() {
    val surface = CountingView(activity)
    writeWrongDensity()
    owner.bind(surface)
    assertCorrectDensity()
    activity.setContentView(surface)
    assertTrue(surface.isAttachedToWindow)

    activity.setContentView(View(activity))
    writeWrongDensity()
    activity.window.decorView.viewTreeObserver.dispatchOnGlobalLayout()
    assertEquals(9f, DisplayMetricsHolder.getScreenDisplayMetrics().density, 0f)

    activity.setContentView(surface)
    assertCorrectDensity()
    writeWrongDensity()
    surface.viewTreeObserver.dispatchOnGlobalLayout()
    assertCorrectDensity()
  }

  private fun writeWrongDensity() {
    DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply { density = 9f })
  }

  private fun assertCorrectDensity() {
    assertEquals(activity.resources.displayMetrics.density, DisplayMetricsHolder.getScreenDisplayMetrics().density, 0f)
  }

  private class CountingView(context: Context) : View(context) {
    var layoutRequests = 0
      private set

    override fun requestLayout() {
      layoutRequests += 1
      super.requestLayout()
    }
  }
}
