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
    checkReveal(waitForSettlement = false)
  }

  @Test fun virtualizedBodyStaysOnTheOutgoingFrameUntilSettlement() {
    checkReveal(waitForSettlement = true)
  }

  @Test fun cancelledSettlementBlendsBackToTheLiveBody() {
    checkReveal(waitForSettlement = true, sendSettlement = false)
  }

  private fun checkReveal(waitForSettlement: Boolean, sendSettlement: Boolean = true) {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val pane = PaneSnapshotView(activity).apply { canvasColor = Color.BLACK }
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
    pane.capture(waitForSettlement)
    pane.layout(0, 0, 80, 40)
    child.layout(0, 0, 80, 40)
    child.setBackgroundColor(Color.BLUE)
    fun draw(): Bitmap = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888).also {
      pane.draw(Canvas(it))
    }
    val first = draw()
    assertEquals(Color.RED, first.getPixel(20, 20))
    assertEquals(if (waitForSettlement) Color.BLACK else Color.BLUE, first.getPixel(60, 20))
    if (waitForSettlement) {
      // A loaded Fold can present the spring's final layout after the passive capture expires.
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(750))
      child.setBackgroundColor(Color.GREEN)
      assertEquals(Color.RED, draw().getPixel(20, 20))
      child.setBackgroundColor(Color.BLUE)
      if (sendSettlement) {
        pane.reveal()
        assertEquals(Color.RED, draw().getPixel(20, 20))
      } else {
        // Advance one frame at a time: a lost settle notification must neither snap nor hang.
        var blended = false
        repeat(100) {
          shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16))
          val pixel = draw().getPixel(20, 20)
          if (Color.red(pixel) in 1..254 && Color.blue(pixel) in 1..254) blended = true
        }
        assertTrue("The outgoing body faded", blended)
      }
    }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
    assertEquals(Color.BLUE, draw().getPixel(20, 20))
    controller.pause().stop().destroy()
  }

  @Test fun transcriptCanFinishAtTheSelectedWidthBeforeItsOuterSpringSettles() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val outer = FrameLayout(activity)
    val pane = PaneSnapshotView(activity).apply { canvasColor = Color.BLACK }
    val host = TimelineScrollHost(activity).apply {
      setBackgroundColor(Color.RED)
    }
    val rows = List(2) { index ->
      View(activity).apply { setTag(com.facebook.react.R.id.view_tag_native_id, "codewide-reading-row:$index") }
    }
    activity.setContentView(outer)
    outer.addView(pane)
    pane.addView(host)
    rows.forEach { host.addView(it) }
    shadowOf(Looper.getMainLooper()).idle()
    outer.layout(0, 0, 80, 40)
    pane.layout(0, 0, 40, 40)
    host.layout(0, 0, 40, 40)
    rows[0].layout(0, 0, 40, 10)
    rows[1].layout(0, 10, 40, 40)
    fun pixel(): Int = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888).let {
      pane.draw(Canvas(it))
      it.getPixel(5, 5)
    }
    // The pressed preset commits its destination before the enclosing pane starts to expand.
    pane.captureReflow(80)
    pane.layout(0, 0, 64, 40)
    host.setBackgroundColor(Color.BLUE)
    host.layout(0, 0, 80, 40)
    rows[0].layout(0, 0, 80, 10)
    rows[1].layout(0, 25, 80, 40)
    repeat(3) { assertEquals("No partial list behind the gap", Color.RED, pixel()) }
    rows[1].layout(0, 10, 80, 40)
    repeat(2) { assertEquals(Color.RED, pixel()) }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(55))
    val mid = pixel()
    assertTrue("Old and new frames blend", Color.red(mid) in 1..254 && Color.blue(mid) in 1..254)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(80))
    assertEquals(Color.BLUE, pixel())

    pane.layout(0, 0, 80, 40)
    // Releasing after a pause at the already displayed width needs no snapshot.
    pane.captureReflow()
    host.setBackgroundColor(Color.GREEN)
    assertEquals(Color.GREEN, pixel())
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
