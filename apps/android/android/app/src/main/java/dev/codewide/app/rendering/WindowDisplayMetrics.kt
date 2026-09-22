package dev.codewide.app.rendering

import android.content.Context
import android.util.DisplayMetrics
import com.facebook.react.uimanager.DisplayMetricsHolder

/** CodeWide's single React surface is the authority for RN's process-global conversion scale. */
internal object WindowDisplayMetrics {
  // Approach: https://github.com/jitsi/jitsi-meet/pull/17844
  // Preserve physical screen dimensions, but convert pixels with the surface's window scale.
  // A separate value is required: changing screen metrics must never mutate Android Resources.
  @Suppress("DEPRECATION") // WHY: RN's screen metrics contract still includes physical display bounds.
  fun synchronize(context: Context): Boolean {
    val window = context.resources.displayMetrics
    val physical = DisplayMetrics().apply { setTo(window) }
    try {
      context.display?.getRealMetrics(physical)
    } catch (_: UnsupportedOperationException) {
      // A context without an associated display can still provide valid window resources.
    }
    val screen = DisplayMetrics().apply {
      setTo(window)
      widthPixels = physical.widthPixels
      heightPixels = physical.heightPixels
    }
    val previousScreen = try {
      DisplayMetricsHolder.getScreenDisplayMetrics()
    } catch (_: IllegalStateException) {
      null
    }
    val previousWindow = try {
      DisplayMetricsHolder.getWindowDisplayMetrics()
    } catch (_: IllegalStateException) {
      null
    }
    if (previousWindow === window && screen == previousScreen) return false
    DisplayMetricsHolder.setWindowDisplayMetrics(window)
    DisplayMetricsHolder.setScreenDisplayMetrics(screen)
    return true
  }
}
