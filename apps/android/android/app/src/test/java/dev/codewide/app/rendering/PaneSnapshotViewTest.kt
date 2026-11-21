package dev.codewide.app.rendering

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.Color
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import android.widget.ScrollView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PaneSnapshotViewTest {
  @Test fun oldPixelsKeepTheirWidthWhileRevealingTheNewBody() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val pane = PaneSnapshotView(activity)
    val child = View(activity)
    val host = FrameLayout(activity)
    activity.setContentView(host)
    host.addView(pane, FrameLayout.LayoutParams(80, 40))
    pane.addView(child)
    shadowOf(Looper.getMainLooper()).idle()
    host.layout(0, 0, 80, 40)
    pane.layout(0, 0, 40, 40)
    child.layout(0, 0, 40, 40)
    child.setBackgroundColor(Color.RED)
    val visible = Rect()
    assertTrue("Outgoing pane is on screen", pane.getLocalVisibleRect(visible))
    assertEquals(Rect(0, 0, 40, 40), visible)
    pane.capture()
    pane.layout(0, 0, 80, 40)
    child.layout(0, 0, 80, 40)
    child.setBackgroundColor(Color.BLUE)
    fun draw(): Bitmap = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888).also {
      pane.draw(Canvas(it))
    }
    val first = draw()
    assertEquals(Color.RED, first.getPixel(20, 20))
    assertEquals(Color.BLUE, first.getPixel(60, 20))
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
    assertEquals(Color.BLUE, draw().getPixel(20, 20))
    controller.pause().stop().destroy()
  }

  @Test fun longerPageKeepsTheBottomOnlyWhenTheReaderWasAtTheEnd() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val pane = PaneSnapshotView(activity).apply { keepScrollEnd = true }
    val host = FrameLayout(activity)
    activity.setContentView(host)
    host.addView(pane, FrameLayout.LayoutParams(100, 40))
    val scroll = ScrollView(activity)
    pane.addView(scroll)
    val page = View(activity)
    scroll.addView(page)
    shadowOf(Looper.getMainLooper()).idle()
    host.layout(0, 0, 100, 40)
    fun resize(width: Int, height: Int) {
      pane.layout(0, 0, width, 40)
      page.minimumHeight = height
      page.layoutParams = FrameLayout.LayoutParams(width, height)
      scroll.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(40, View.MeasureSpec.EXACTLY))
      scroll.layout(0, 0, width, 40)
      pane.draw(Canvas(Bitmap.createBitmap(width, 40, Bitmap.Config.ARGB_8888)))
    }
    resize(100, 80)
    scroll.scrollTo(0, 40)
    assertEquals("Page starts scrolled to the end", 40, scroll.scrollY)
    pane.capture()
    resize(60, 120)
    assertEquals(80, scroll.scrollY)
    scroll.scrollTo(0, 15)
    pane.capture()
    resize(100, 80)
    assertEquals(15, scroll.scrollY)
    controller.pause().stop().destroy()
  }
}
