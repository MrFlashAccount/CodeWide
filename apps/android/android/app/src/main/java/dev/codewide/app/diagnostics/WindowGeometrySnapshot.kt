package dev.codewide.app.diagnostics

import android.app.Activity
import android.os.Build
import android.util.DisplayMetrics
import android.view.View
import android.view.ViewGroup
import com.facebook.react.ReactRootView
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.json.JSONArray
import org.json.JSONObject

/** Whitelisted numeric geometry only: never inspect text, tags, titles, or view contents. */
internal object WindowGeometrySnapshot {
  fun read(activity: Activity): String {
    val decor = activity.window.decorView
    val configuration = activity.resources.configuration
    val bounds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.windowManager.currentWindowMetrics.bounds
    } else {
      null
    }
    val surfaces = JSONArray()
    collectSurfaces(decor, surfaces, intArrayOf(1024))
    return JSONObject()
      .put("displayId", decor.display?.displayId ?: JSONObject.NULL)
      .put("rotation", decor.display?.rotation ?: JSONObject.NULL)
      .put("multiWindow", activity.isInMultiWindowMode)
      .put("fontScale", configuration.fontScale.toDouble())
      .put("orientation", configuration.orientation)
      .put("screenWidthDp", configuration.screenWidthDp)
      .put("screenHeightDp", configuration.screenHeightDp)
      .put("smallestScreenWidthDp", configuration.smallestScreenWidthDp)
      .put("windowWidthPx", bounds?.width() ?: JSONObject.NULL)
      .put("windowHeightPx", bounds?.height() ?: JSONObject.NULL)
      .put("decorWidthPx", decor.width)
      .put("decorHeightPx", decor.height)
      .put("activityResources", metrics(activity.resources.displayMetrics))
      .put("applicationResources", metrics(activity.application.resources.displayMetrics))
      .put("reactScreen", reactMetrics(screen = true))
      .put("reactWindow", reactMetrics(screen = false))
      .put("surfaces", surfaces)
      .toString()
  }

  private fun reactMetrics(screen: Boolean): Any = try {
    metrics(if (screen) DisplayMetricsHolder.getScreenDisplayMetrics() else DisplayMetricsHolder.getWindowDisplayMetrics())
  } catch (_: IllegalStateException) {
    // RN may not have initialized its holder yet. Missing is evidence, not zero density.
    JSONObject.NULL
  }

  private fun metrics(value: DisplayMetrics): JSONObject = JSONObject()
    .put("widthPx", value.widthPixels)
    .put("heightPx", value.heightPixels)
    .put("density", value.density.toDouble())
    .put("densityDpi", value.densityDpi)
    .put("scaledDensity", scaledDensity(value))

  // WHY: Record RN's actual legacy conversion input; this is observation, not font sizing.
  @Suppress("DEPRECATION")
  private fun scaledDensity(value: DisplayMetrics): Double = value.scaledDensity.toDouble()

  private fun collectSurfaces(view: View, result: JSONArray, budget: IntArray) {
    if (budget[0]-- <= 0) return
    if (view is ReactRootView) {
      result.put(JSONObject()
        .put("widthPx", view.width)
        .put("heightPx", view.height)
        .put("measuredWidthPx", view.measuredWidth)
        .put("measuredHeightPx", view.measuredHeight)
        .put("resources", metrics(view.resources.displayMetrics)))
      return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        if (budget[0] <= 0) break
        collectSurfaces(view.getChildAt(index), result, budget)
      }
    }
  }
}
