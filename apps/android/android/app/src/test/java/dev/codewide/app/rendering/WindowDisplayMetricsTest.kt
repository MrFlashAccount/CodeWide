package dev.codewide.app.rendering

import android.app.Activity
import android.hardware.display.DisplayManager
import android.util.DisplayMetrics
import android.view.Display
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.PixelUtil
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class WindowDisplayMetricsTest {
  private val controller = Robolectric.buildActivity(Activity::class.java).setup()
  private val activity = controller.get()

  @After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
    DisplayMetricsHolder.setWindowDisplayMetrics(null)
    controller.pause().stop().destroy()
  }

  @Test
  @Suppress("DEPRECATION") // WHY: Exercise the same physical-bounds and scaledDensity contract as RN.
  fun foldWindowUsesItsOwnScaleWhileKeepingPhysicalScreenBounds() {
    val display = activity.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    val context = activity.createDisplayContext(display)
    val physical = DisplayMetrics()
    display.getRealMetrics(physical)
    val window = context.resources.displayMetrics.apply {
      densityDpi = 321
      density = 321 / 160f
      scaledDensity = density
      widthPixels = 886
      heightPixels = 1889
    }
    DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply {
      setTo(window)
      densityDpi = 374
      density = 374 / 160f
    })
    DisplayMetricsHolder.setWindowDisplayMetrics(window)

    assertTrue(WindowDisplayMetrics.synchronize(context))
    // Observable regression: measured text pixels must survive conversion to Yoga dp and back
    // through the surface's density, instead of losing ~14% of their allocated width.
    assertEquals(100f, PixelUtil.toDIPFromPixel(100f) * window.density, 0.001f)
    assertEquals(20f * window.density, PixelUtil.toPixelFromDIP(20f), 0.001f)
    assertEquals(20f * window.scaledDensity, PixelUtil.toPixelFromSP(20f), 0.001f)
    val screen = DisplayMetricsHolder.getScreenDisplayMetrics()
    assertEquals(physical.widthPixels, screen.widthPixels)
    assertEquals(physical.heightPixels, screen.heightPixels)
    assertEquals(886, window.widthPixels)
    assertNotSame(window, screen)
    assertFalse(WindowDisplayMetrics.synchronize(context))
  }

  @Test
  @Suppress("DEPRECATION") // WHY: RN consumes this legacy font-scale field.
  fun initializesAndTracksResizeFontScaleAndReturningFullscreen() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
    DisplayMetricsHolder.setWindowDisplayMetrics(null)
    val window = activity.resources.displayMetrics
    for (dpi in listOf(374, 321, 374)) {
      window.densityDpi = dpi
      window.density = dpi / 160f
      window.scaledDensity = window.density * 1.3f
      window.widthPixels = if (dpi == 321) 886 else 1968
      assertTrue(WindowDisplayMetrics.synchronize(activity))
      assertEquals(window.widthPixels, DisplayMetricsHolder.getWindowDisplayMetrics().widthPixels)
      assertEquals(window.scaledDensity, DisplayMetricsHolder.getScreenDisplayMetrics().scaledDensity, 0f)
      assertEquals(100f, PixelUtil.toDIPFromPixel(100f) * window.density, 0.001f)
      assertFalse(WindowDisplayMetrics.synchronize(activity))
    }
    // A font-only change must also invalidate the snapshot even when density stays the same.
    window.scaledDensity = window.density * 1.5f
    assertTrue(WindowDisplayMetrics.synchronize(activity))
    assertEquals(window.scaledDensity, DisplayMetricsHolder.getScreenDisplayMetrics().scaledDensity, 0f)
  }
}
