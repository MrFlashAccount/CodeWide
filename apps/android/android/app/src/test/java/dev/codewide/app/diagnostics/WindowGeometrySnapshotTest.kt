package dev.codewide.app.diagnostics

import android.app.Activity
import android.util.DisplayMetrics
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class WindowGeometrySnapshotTest {
  @Test
  fun recordsDensityDisagreementWithoutRepairingItOrReadingContent() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup()
    val activity = controller.get()
    activity.title = "private chat content"
    val original = DisplayMetrics().apply { density = 3f; densityDpi = 480 }
    DisplayMetricsHolder.setScreenDisplayMetrics(original)
    DisplayMetricsHolder.setWindowDisplayMetrics(activity.resources.displayMetrics)
    try {
      val raw = WindowGeometrySnapshot.read(activity)
      val geometry = JSONObject(raw)
      assertEquals(3.0, geometry.getJSONObject("reactScreen").getDouble("density"), 0.0)
      assertEquals(activity.resources.displayMetrics.density.toDouble(), geometry.getJSONObject("activityResources").getDouble("density"), 0.0)
      assertEquals(3f, DisplayMetricsHolder.getScreenDisplayMetrics().density, 0f)
      assertFalse(raw.contains("private chat content"))
    } finally {
      DisplayMetricsHolder.setScreenDisplayMetrics(null)
      DisplayMetricsHolder.setWindowDisplayMetrics(null)
      controller.pause().stop().destroy()
    }
  }
}
