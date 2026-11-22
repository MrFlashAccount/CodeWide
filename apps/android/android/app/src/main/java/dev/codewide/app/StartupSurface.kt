package dev.codewide.app

import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.uimanager.util.ReactFindViewUtil

/** Waits for the first drawable product screen, including lock and recovery, on the UI thread. */
internal fun releaseSplashOnFirstSurface(decor: View, release: () -> Unit) {
  val listener = object : ViewTreeObserver.OnPreDrawListener {
    override fun onPreDraw(): Boolean {
      val surface = ReactFindViewUtil.findView(decor, "codewide-startup-surface")
      if (surface != null && surface.isShown && surface.width > 0 && surface.height > 0) {
        decor.viewTreeObserver.removeOnPreDrawListener(this)
        release()
      }
      return true
    }
  }
  decor.viewTreeObserver.addOnPreDrawListener(listener)
  // Expo can also reveal its own startup error UI before a product screen exists.
  decor.viewTreeObserver.registerFrameCommitCallback { decor.viewTreeObserver.removeOnPreDrawListener(listener) }
}
