package dev.codewide.app.rendering

import android.view.View
import android.widget.ScrollView
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class TimelineScrollHostTest {
  @Test
  fun followsEachResizeWithinTheTailThresholdBeforeReturningFromLayout() {
    val scroll = transcript()
    scroll.scrollTo(0, 1_490) // Within 2% of the original 500px viewport.
    for (height in listOf(420, 311, 310, 311, 500)) {
      resize(scroll, height)
      assertEquals(2_000 - height, scroll.scrollY)
    }
  }

  @Test
  fun preservesTheReadingPositionOutsideTheThresholdAndAfterScrollingWithTheImeOpen() {
    val scroll = transcript()
    scroll.scrollTo(0, 1_489)
    resize(scroll, 400)
    assertEquals(1_489, scroll.scrollY)
    scroll.scrollTo(0, 800)
    resize(scroll, 300)
    resize(scroll, 500)
    assertEquals(800, scroll.scrollY)
  }

  private fun transcript(): ScrollView {
    val context = RuntimeEnvironment.getApplication()
    val host = TimelineScrollHost(context).apply { endThresholdRatio = 0.02f }
    return ScrollView(context).apply {
      host.addView(this)
      addView(View(context).apply { minimumHeight = 2_000 })
      resize(this, 500)
      assertEquals(2_000, getChildAt(0).height)
    }
  }

  private fun resize(scroll: ScrollView, height: Int) {
    scroll.measure(
      View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    scroll.layout(0, 0, 300, height)
  }
}
