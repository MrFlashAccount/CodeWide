package dev.codewide.app.performance

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class TimelineViewObservationTest {
  @Test fun observesNativeGeometryAndDrawWithoutMovingContentAndReleasesListeners() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val scroll = FrameLayout(activity).apply { id = 42 }
    val content = FrameLayout(activity)
    scroll.addView(content, FrameLayout.LayoutParams(400, 4000))
    activity.setContentView(scroll)
    scroll.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY))
    scroll.layout(0, 0, 400, 600)
    scroll.scrollTo(0, 3000)
    assertEquals(3000, scroll.scrollY)
    val events = mutableListOf<TimelineTraceEvent.Geometry>()
    var detached = false
    val observer = TimelineViewObservation(scroll, { events.add(it) }) { detached = true }
    observer.sample(TimelineGeometryPhase.SCROLL)
    scroll.viewTreeObserver.dispatchOnDraw()
    assertEquals(3000, scroll.scrollY)
    val draw = events.last()
    assertEquals(TimelineGeometryPhase.DRAW, draw.phase)
    assertEquals(3000, draw.offsetPx)
    assertEquals(600, draw.viewportHeightPx)
    assertEquals(4000, draw.contentHeightPx)
    activity.setContentView(FrameLayout(activity))
    assertTrue(detached)
    assertEquals(TimelineGeometryPhase.DETACH, events.last().phase)
    val count = events.size
    activity.window.decorView.viewTreeObserver.dispatchOnDraw()
    assertEquals(count, events.size)
    observer.close()
    controller.pause().stop().destroy()
  }
}
