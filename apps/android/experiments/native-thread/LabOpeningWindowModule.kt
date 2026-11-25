package dev.codewide.app

import android.os.Trace
import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Lab-only acknowledgement for a frame containing real, visible transcript text. */
class LabOpeningWindowModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "CodeWideLabOpeningWindow"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun mark(tag: String): Boolean {
    if (Trace.isEnabled()) {
      Trace.beginSection("cw.stage.$tag")
      Trace.endSection()
    }
    return true
  }

  @ReactMethod
  fun afterBubbleFrame(promise: Promise) {
    val activity = context.currentActivity ?: return promise.resolve(false)
    activity.runOnUiThread {
      val probe = BubbleProbe(activity)
      OpeningFrame(activity.window.decorView, probe, promise).start()
    }
  }
}

private class OpeningFrame(
  private val decor: View,
  private val probe: BubbleProbe,
  private val promise: Promise,
) : ViewTreeObserver.OnPreDrawListener {
  private var settled = false
  private val timeout = Runnable { finish(false) }

  fun start() {
    decor.viewTreeObserver.addOnPreDrawListener(this)
    decor.postDelayed(timeout, 2300)
    decor.postInvalidateOnAnimation()
  }

  override fun onPreDraw(): Boolean {
    if (android.os.Build.VERSION.SDK_INT < 29 || !decor.isHardwareAccelerated) {
      finish(false)
    } else if (probe.hasVisibleBubble()) {
      val observer = decor.viewTreeObserver
      observer.removeOnPreDrawListener(this)
      observer.registerFrameCommitCallback { decor.post { finish(true) } }
    }
    return true
  }

  private fun finish(committed: Boolean) {
    if (settled) return
    settled = true
    decor.removeCallbacks(timeout)
    if (decor.viewTreeObserver.isAlive) decor.viewTreeObserver.removeOnPreDrawListener(this)
    promise.resolve(committed)
  }
}
