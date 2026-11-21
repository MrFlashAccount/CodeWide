package dev.codewide.app.rendering

import android.graphics.Rect
import android.view.View
import android.widget.TextView
import androidx.core.view.children
import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CompletedFooterViewTest {
  @Test fun optionalMetricsGiveWayInOrderAndTheCostPressAnchorsToItsVisibleLabel() {
    var anchor: Rect? = null
    val footer = CompletedFooterView(RuntimeEnvironment.getApplication()) { _, rect -> anchor = rect }
    footer.applyTheme(JavaOnlyMap.of("font", "sans-serif", "textSize", 12.0,
      "dotSize", 7.0, "dotGap", 4.0, "inset", 12.0, "separatorGap", 8.0, "touchPadding", 5.0))
    footer.applyContent(JavaOnlyMap.of("status", "Completed", "duration", "3s", "time", "22:18",
      "price", "≈\$0.120", "priceLabel", "Estimated cost", "tokens", "↓800K ↑1200", "tokenLabel", "Exact token counts"))

    fun size(width: Int) {
      val exact = View.MeasureSpec.EXACTLY
      footer.measure(View.MeasureSpec.makeMeasureSpec(width, exact), View.MeasureSpec.makeMeasureSpec(32, exact))
      footer.layout(0, 0, width, 32)
    }
    size(1000)
    val tokens = footer.children.single { it.contentDescription == "Exact token counts" }
    val price = footer.children.single { it.contentDescription == "Estimated cost" }
    val clock = footer.children.filterIsInstance<TextView>().single { it.text.toString() == "22:18" }
    assertEquals(View.VISIBLE, tokens.visibility)
    assertTrue(price.isFocusable)
    assertTrue(price.performClick())
    assertEquals(Rect(price.left, price.top, price.right, price.bottom), anchor)
    val spacingAfterPrice = 1000 - clock.right
    // Exactly enough for the price and time, but not the tokens.
    size(price.right + clock.width + spacingAfterPrice * 2 - tokens.width)
    assertEquals(View.INVISIBLE, tokens.visibility)
    assertEquals(View.VISIBLE, price.visibility)
    size(clock.width + spacingAfterPrice * 2 + 15)
    assertEquals(View.INVISIBLE, price.visibility)
    assertEquals(View.VISIBLE, clock.visibility)
    size(1000)
    assertEquals(View.VISIBLE, price.visibility)
    assertEquals(View.VISIBLE, tokens.visibility)
  }
}
