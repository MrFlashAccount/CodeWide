package dev.codewide.app.remote

import android.app.Activity
import android.graphics.PixelFormat
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.interfaces.fabric.ReactSurface
import java.lang.ref.WeakReference
import kotlin.math.min

/**
 * One narrow, touchable application window for toasts. Its subwindow type sits above
 * the Activity's Compose sheets and dialogs without a system-overlay permission.
 */
class AppNoticeWindowModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private var requestedVisible = false
  private var hostPaused = false
  private var activity: WeakReference<Activity>? = null
  private var manager: WindowManager? = null
  private var surface: ReactSurface? = null
  private var windowView: ViewGroup? = null

  init {
    context.addLifecycleEventListener(this)
  }

  override fun getName(): String = "AppNoticeWindow"

  @ReactMethod
  fun setVisible(visible: Boolean) {
    context.runOnUiQueueThread {
      requestedVisible = visible
      if (visible && !hostPaused) attach() else detach()
    }
  }

  override fun onHostResume() {
    context.runOnUiQueueThread {
      hostPaused = false
      if (requestedVisible) attach()
    }
  }

  override fun onHostPause() {
    context.runOnUiQueueThread {
      hostPaused = true
      detach()
    }
  }

  override fun onHostDestroy() {
    context.runOnUiQueueThread {
      requestedVisible = false
      detach()
    }
  }

  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    context.runOnUiQueueThread {
      requestedVisible = false
      detach()
    }
    super.invalidate()
  }

  private fun attach() {
    val currentActivity = context.currentActivity ?: return
    if (activity?.get() === currentActivity && windowView?.isAttachedToWindow == true) return
    detach()

    val token = currentActivity.window.decorView.windowToken ?: return
    val windowManager = currentActivity.windowManager
    val reactHost = (currentActivity.application as ReactApplication).reactHost
    val nextSurface = reactHost.createSurface(currentActivity, "CodeWideAppNotice", null)
    val view = nextSurface.view ?: run {
      nextSurface.stop()
      return
    }
    val density = currentActivity.resources.displayMetrics.density
    val windowWidth = currentActivity.resources.displayMetrics.widthPixels
    val horizontalMargin = (8 * density).toInt()
    val maxWidth = (456 * density).toInt()
    val width = min(windowWidth - horizontalMargin * 2, maxWidth).coerceAtLeast(1)
    val statusInset = currentActivity.window.decorView.rootWindowInsets
      ?.getInsets(WindowInsets.Type.statusBars())?.top ?: 0
    val params = WindowManager.LayoutParams(
      width,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_ATTACHED_DIALOG,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      this.token = token
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = statusInset + (4 * density).toInt()
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
      title = "CodeWide notices"
      layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      setFitInsetsTypes(0)
    }
    try {
      windowManager.addView(view, params)
      nextSurface.start()
      activity = WeakReference(currentActivity)
      manager = windowManager
      surface = nextSurface
      windowView = view
    } catch (error: RuntimeException) {
      if (view.isAttachedToWindow) windowManager.removeViewImmediate(view)
      nextSurface.stop()
      Log.e(LOG_TAG, "Could not attach application notice window", error)
    }
  }

  private fun detach() {
    val view = windowView
    val windowManager = manager
    windowView = null
    manager = null
    activity = null
    if (view?.isAttachedToWindow == true && windowManager != null) {
      try {
        windowManager.removeViewImmediate(view)
      } catch (error: RuntimeException) {
        Log.e(LOG_TAG, "Could not remove application notice window", error)
      }
    }
    surface?.stop()
    surface = null
  }

  private companion object {
    const val LOG_TAG = "CodeWideNotices"
  }
}
