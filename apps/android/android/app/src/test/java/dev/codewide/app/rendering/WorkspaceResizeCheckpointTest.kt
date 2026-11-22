package dev.codewide.app.rendering

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.R
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "mdpi", manifest = Config.NONE)
class WorkspaceResizeCheckpointTest {
  private val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
  private val activity = controller.get()
  private val decor = activity.window.decorView
  private val frame = FrameLayout(activity)
  private val catalog = View(activity)
  private val destination = FrameLayout(activity)
  private val viewport = View(activity)
  private val checkpoint = WorkspaceResizeCheckpoint(activity)

  private fun startWide() {
    frame.addView(catalog)
    frame.addView(destination)
    destination.addView(viewport)
    viewport.setTag(R.id.view_tag_native_id, "codewide-destination-viewport")
    frame.addView(checkpoint)
    checkpoint.wideFrom = 720f
    checkpoint.target = PaneResizeTarget(840.0, 320.0, 320.0, 520.0)
    decor.layout(0, 0, 840, 600)
    activity.setContentView(frame)
    frame.layout(0, 0, 840, 600)
    catalog.layout(0, 0, 320, 600)
    destination.layout(320, 0, 840, 600)
    viewport.layout(0, 0, 520, 600)
  }

  @After fun dispose() { controller.pause().stop().destroy() }

  @Test fun resizedWindowPresentsOnlyAfterTheStackMatchesTheCommittedPhoneLayout() {
    startWide()
    decor.layout(0, 0, 411, 800)
    assertFalse(checkpoint.onPreDraw())
    checkpoint.target = PaneResizeTarget(411.0, 411.0, 0.0, 411.0)
    frame.layout(0, 0, 411, 800)
    catalog.layout(0, 0, 411, 800)
    destination.layout(0, 0, 411, 800)
    viewport.layout(0, 0, 91, 800)
    assertFalse(checkpoint.onPreDraw())
    viewport.layout(0, 0, 411, 800)
    assertTrue(checkpoint.onPreDraw())
    decor.layout(0, 0, 840, 600)
    assertFalse(checkpoint.onPreDraw())
    frame.visibility = View.GONE
    assertTrue(checkpoint.onPreDraw())
  }

  @Test fun keyboardAndSameModeResizesKeepDrawingWhileMeasurementsChange() {
    startWide()
    decor.layout(0, 0, 840, 320)
    assertTrue(checkpoint.onPreDraw())
    decor.layout(0, 0, 780, 600)
    assertTrue(checkpoint.onPreDraw())
  }

  @Test fun anUnresponsiveWorkspaceEventuallyLetsTheWindowDrawAndRecover() {
    startWide()
    decor.layout(0, 0, 411, 800)
    assertFalse(checkpoint.onPreDraw())
    ShadowSystemClock.advanceBy(Duration.ofMillis(1_500))
    assertFalse(checkpoint.onPreDraw())
    ShadowSystemClock.advanceBy(Duration.ofSeconds(2))
    assertTrue(checkpoint.onPreDraw())
    assertTrue(checkpoint.onPreDraw())
  }
}
