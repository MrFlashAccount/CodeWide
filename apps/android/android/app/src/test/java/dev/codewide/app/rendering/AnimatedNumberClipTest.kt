package dev.codewide.app.rendering

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
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
class AnimatedNumberClipTest {
  // React lays the counter out at its pixel-rounded measured width; the drawn text may be a
  // fraction wider. The last glyph must not be shaved off at the view's right edge.
  @Test fun lastGlyphPastTheMeasuredWidthIsStillDrawn() {
    val counter = AnimatedNumberView(RuntimeEnvironment.getApplication()).apply {
      setPendingValue(0.0)
      setPendingPrefix("Branch · ")
      setPendingFontSize(12f)
      setPendingLineHeight(16f)
      setPendingAnimate(false)
      commitProps()
    }
    val height = 40
    val measured = 400
    val canvas = Bitmap.createBitmap(measured, height, Bitmap.Config.ARGB_8888)
    counter.layOut(measured, height)
    counter.draw(Canvas(canvas))
    val textEnd = canvas.lastInkColumn()
    assertTrue("Counter must draw visible text", textEnd > 0)

    val narrowed = textEnd - 2
    val clipped = Bitmap.createBitmap(measured, height, Bitmap.Config.ARGB_8888)
    counter.layOut(narrowed, height)
    counter.draw(Canvas(clipped))
    assertTrue("Glyphs past the view width must stay drawn", clipped.lastInkColumn() > narrowed)
    counter.release()
  }

  private fun View.layOut(width: Int, height: Int) {
    measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(0, 0, width, height)
  }

  private fun Bitmap.lastInkColumn(): Int {
    for (x in width - 1 downTo 0) for (y in 0 until height) if (getPixel(x, y) ushr 24 > 0) return x
    return -1
  }
}
