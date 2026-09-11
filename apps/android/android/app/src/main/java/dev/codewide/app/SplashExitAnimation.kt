package dev.codewide.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.app.Activity
import android.view.animation.AccelerateInterpolator
import dev.codewide.app.remote.NativeStartupTrace

/** Expo still owns readiness; this listener owns only the Android 14+ exit animation. */
internal object SplashExitAnimation {
  const val DURATION_MS = 100L

  fun install(activity: Activity) {
    // minSdk is 34. Replace Expo's platform exit listener, not its content-ready gate.
    activity.splashScreen.setOnExitAnimationListener { view ->
      NativeStartupTrace.markSplashExitRequested()
      view.animate()
        .setDuration(DURATION_MS)
        .alpha(0f)
        .setInterpolator(AccelerateInterpolator())
        .setListener(object : AnimatorListenerAdapter() {
          private var cancelled = false

          override fun onAnimationStart(animation: Animator) {
            NativeStartupTrace.markSplashAnimationStarted()
          }

          override fun onAnimationCancel(animation: Animator) {
            cancelled = true
          }

          override fun onAnimationEnd(animation: Animator) {
            view.remove()
            NativeStartupTrace.markSplashRemoved(cancelled)
          }
        })
        .start()
    }
  }
}
