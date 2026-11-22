package dev.codewide.app

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.R
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class StartupSurfaceTest {
  @Test fun releasesOnceWhenTheSelectedSurfaceCanActuallyDraw() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val root = FrameLayout(activity)
    activity.setContentView(root)
    var releases = 0
    releaseSplashOnFirstSurface(activity.window.decorView) { releases++ }
    fun draw() { root.viewTreeObserver.dispatchOnPreDraw() }

    draw()
    val surface = View(activity).apply { setTag(R.id.view_tag_native_id, "codewide-startup-surface") }
    root.addView(surface)
    draw()
    assertEquals(0, releases)
    surface.visibility = View.INVISIBLE
    surface.layout(0, 0, 400, 600)
    draw()
    assertEquals(0, releases)
    surface.visibility = View.VISIBLE
    draw()
    draw()
    assertEquals(1, releases)
    controller.pause().stop().destroy()
  }
}
