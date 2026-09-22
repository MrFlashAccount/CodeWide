package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.DisplayMetrics
import android.view.View
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AnimatedNumberResizeTest {
  @Test fun retainedCounterUsesCurrentWindowScaleWithoutChangingValue() {
    val context = RuntimeEnvironment.getApplication()
    setDensity(context, 2f)
    val retained = counter(context)
    draw(retained, 400, 60)
    for (density in listOf(1f, 3f, 1.5f, 2f)) {
      setDensity(context, density)
      val width = (200 * density).toInt()
      val height = (30 * density).toInt()
      val actual = draw(retained, width, height)
      val fresh = counter(context)
      val expected = draw(fresh, width, height)
      assertEquals("Changes · 1,124", retained.contentDescription)
      assertTrue("Retained count must redraw at window density $density", expected.sameAs(actual))
      fresh.release()
    }
    retained.release()
  }

  @Test fun transientScreenDensityCannotBeCachedAsCounterFontSize() {
    val context = RuntimeEnvironment.getApplication()
    setDensity(context, 2f)
    DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply {
      setTo(context.resources.displayMetrics)
      density = 4f
      scaledDensity = 4f
    })
    val retained = counter(context)
    setDensity(context, 2f)
    val expected = draw(counter(context), 400, 60)
    assertTrue("Screen-scale writes must not determine window text size", expected.sameAs(draw(retained, 400, 60)))
    retained.release()
  }

  @Test fun retainedCounterTracksFontScaleAndCapsItLikeMeasuredText() {
    val context = RuntimeEnvironment.getApplication()
    setDensity(context, 2f)
    val retained = counter(context)
    draw(retained, 400, 60)
    context.resources.displayMetrics.scaledDensity = 2f * 2f
    val capped = draw(retained, 400, 60)
    context.resources.displayMetrics.scaledDensity = 2f * 1.3f
    assertTrue("Native drawing must share AppText's accessibility cap", capped.sameAs(draw(counter(context), 400, 60)))
    retained.release()
  }

  private fun counter(context: Context) = AnimatedNumberView(context).apply {
    setPendingValue(1124.0)
    setPendingPrefix("Changes · ")
    setPendingFontSize(11f)
    setPendingMaxFontSizeMultiplier(1.3f)
    setPendingLineHeight(16f)
    setPendingAnimate(false)
    commitProps()
  }

  private fun setDensity(context: Context, density: Float) {
    context.resources.displayMetrics.apply {
      this.density = density
      scaledDensity = density
      densityDpi = (density * 160).toInt()
    }
    DisplayMetricsHolder.setWindowDisplayMetrics(context.resources.displayMetrics)
    DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply { setTo(context.resources.displayMetrics) })
  }

  private fun draw(view: View, width: Int, height: Int): Bitmap {
    view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, width, height)
    return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
      view.draw(Canvas(it))
      assertTrue("Counter must draw visible text", it.getPixelsPresent())
    }
  }

  private fun Bitmap.getPixelsPresent(): Boolean {
    for (y in 0 until height) for (x in 0 until width) if (getPixel(x, y) ushr 24 > 0) return true
    return false
  }
}
