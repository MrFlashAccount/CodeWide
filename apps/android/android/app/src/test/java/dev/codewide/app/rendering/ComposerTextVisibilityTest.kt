package dev.codewide.app.rendering

import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.ViewGroup
import androidx.appcompat.widget.AppCompatEditText
import android.view.View
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.swmansion.enriched.markdown.input.EnrichedMarkdownTextInputView
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
class ComposerTextVisibilityTest {
  @Test fun plainTypingKeepsForegroundAndVisibleLayoutAfterClearingLongText() {
    val context = RuntimeEnvironment.getApplication()
    DisplayMetricsHolder.initDisplayMetrics(context)
    val editor = EnrichedMarkdownTextInputView(context)
    editor.layoutParams = ViewGroup.LayoutParams(400, 120)
    editor.setColorFromProps(Color.WHITE)
    editor.setFontSizeFromProps(15f)
    editor.setLineHeightFromProps(21f)
    layout(editor)
    for (content in listOf("hello", "line\n".repeat(50), "", "new chat")) {
      editor.text?.replace(0, editor.length(), content)
      editor.setSelection(editor.length())
      layout(editor)
      assertEquals(content, editor.text.toString())
      assertEquals(Color.WHITE, editor.currentTextColor)
      assertTrue(editor.paint.textSize > 0)
      assertTrue(editor.width > editor.totalPaddingLeft + editor.totalPaddingRight)
      if (content.isNotEmpty()) {
        val textLayout = requireNotNull(editor.layout)
        assertTrue("Text must not remain scrolled beyond its layout", editor.scrollY < textLayout.height)
        val bitmap = Bitmap.createBitmap(editor.width, editor.height, Bitmap.Config.ARGB_8888)
        // ViewGroup applies the child's scroll translation before draw().
        val canvas = Canvas(bitmap)
        canvas.translate(-editor.scrollX.toFloat(), -editor.scrollY.toFloat())
        editor.draw(canvas)
        var visibleForeground = 0
        for (y in 0 until bitmap.height) {
          for (x in 0 until bitmap.width) {
            val pixel = bitmap.getPixel(x, y)
            if (Color.alpha(pixel) > 0 && Color.red(pixel) > 200 && Color.green(pixel) > 200 && Color.blue(pixel) > 200) {
              visibleForeground += 1
            }
          }
        }
        assertTrue("Typing must draw visible foreground pixels (length=${content.length}, scroll=${editor.scrollY}, layout=${textLayout.height})", visibleForeground > 0)
      }
    }
  }

  @Test fun platformControlDrawsPlainTextInTheSameHarness() {
    val context = RuntimeEnvironment.getApplication()
    val editor = AppCompatEditText(context)
    editor.layoutParams = ViewGroup.LayoutParams(400, 120)
    editor.setTextColor(Color.WHITE)
    editor.setText("hello")
    layout(editor)
    val bitmap = Bitmap.createBitmap(400, 120, Bitmap.Config.ARGB_8888)
    editor.draw(Canvas(bitmap))
    var foreground = 0
    for (y in 0 until 120) {
      for (x in 0 until 400) {
        val pixel = bitmap.getPixel(x, y)
        if (Color.alpha(pixel) > 0 && Color.red(pixel) > 200 && Color.green(pixel) > 200 && Color.blue(pixel) > 200) foreground += 1
      }
    }
    assertTrue("Platform control must render in this harness", foreground > 0)
  }

  private fun layout(editor: AppCompatEditText) {
    editor.measure(
      View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(120, View.MeasureSpec.EXACTLY),
    )
    editor.layout(0, 0, 400, 120)
  }
}
