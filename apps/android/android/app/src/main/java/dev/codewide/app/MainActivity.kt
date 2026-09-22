package dev.codewide.app

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.ReactRootView

import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager
import dev.codewide.app.remote.NativeStartupTrace
import dev.codewide.app.diagnostics.WindowDiagnostics
import dev.codewide.app.rendering.SurfaceDisplayMetrics

class MainActivity : ReactActivity() {
  private val surfaceDisplayMetrics = SurfaceDisplayMetrics()

  override fun onCreate(savedInstanceState: Bundle?) {
    NativeStartupTrace.markActivityStarted()
    NativeStartupTrace.registerContentMarker()
    SplashScreenManager.registerOnActivity(this)
    SplashExitAnimation.install(this)
    super.onCreate(null)
    surfaceDisplayMetrics.synchronize()
  }

  override fun onContentChanged() {
    super.onContentChanged()
    // Expo can install the React surface directly or wrap it in a native container.
    surfaceDisplayMetrics.bind(findReactSurface(window.decorView))
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    WindowDiagnostics.capture("configuration_before")
    super.onConfigurationChanged(newConfig)
    WindowDiagnostics.capture("configuration_react")
    surfaceDisplayMetrics.synchronize()
    WindowDiagnostics.capture("configuration_activity")
  }

  override fun onResume() {
    super.onResume()
    surfaceDisplayMetrics.synchronize()
    WindowDiagnostics.attach(this)
  }

  override fun onPause() {
    WindowDiagnostics.detach(this)
    super.onPause()
  }

  override fun onDestroy() {
    surfaceDisplayMetrics.dispose()
    super.onDestroy()
  }

  private fun findReactSurface(view: View): ReactRootView? {
    if (view is ReactRootView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        val surface = findReactSurface(view.getChildAt(index))
        if (surface != null) return surface
      }
    }
    return null
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
