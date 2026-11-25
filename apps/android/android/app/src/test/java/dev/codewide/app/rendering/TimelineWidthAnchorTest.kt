package dev.codewide.app.rendering

import android.app.Activity
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import android.widget.ScrollView
import com.facebook.react.R
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class TimelineWidthAnchorTest {
  @Test fun keepsTheLastRowBottomInPlaceWhileItsMeasuredHeightCatchesUp() = verify(true)
  @Test fun keepsTheFirstVisibleRowAtItsReadingOffsetInHistory() = verify(false)

  private fun verify(atEnd: Boolean) {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val scroll = ScrollView(activity)
    val content = FrameLayout(activity)
    activity.setContentView(scroll)
    scroll.addView(content, FrameLayout.LayoutParams(320, 800))
    val rows = List(2) {
      FrameLayout(activity).apply {
        setTag(R.id.view_tag_native_id, "codewide-reading-row:$it")
        content.addView(this, FrameLayout.LayoutParams(320, 400))
        addView(View(activity), FrameLayout.LayoutParams(320, 400))
      }
    }
    shadowOf(Looper.getMainLooper()).idle()
    scroll.layout(0, 0, 320, 300)
    content.layout(0, 0, 320, 800)
    rows[0].layout(0, 0, 320, 400)
    rows[1].layout(0, 400, 320, 800)
    scroll.scrollTo(0, if (atEnd) 500 else 200)
    rows.forEach { it.getChildAt(0).layout(0, 0, 320, 400) }
    val anchor = TimelineWidthAnchor()
    val row = (if (atEnd) rows[1] else rows[0]).getChildAt(0)
    val coords = IntArray(2)
    fun edge(): Int {
      row.getLocationInWindow(coords)
      return coords[1] + if (atEnd) row.height else 0
    }
    val expected = edge()
    anchor.begin(scroll, 0.02f)
    scroll.layout(0, 0, 280, 300)
    if (atEnd) {
      row.layout(0, row.top, 280, row.bottom + 1)
      anchor.beforeDraw()
      assertEquals("A rounded physical tail is already at rest", 0f, content.translationY, 0f)
    }
    row.layout(0, row.top + 15, 280, row.bottom + 45)
    anchor.beforeDraw()
    assertEquals(expected, edge())
    content.layout(0, 0, 280, 860)
    anchor.settle()
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    anchor.beforeDraw()
    assertEquals(expected, edge())
    assertEquals(0f, content.translationY, 0f)
    controller.pause().stop().destroy()
  }
}
