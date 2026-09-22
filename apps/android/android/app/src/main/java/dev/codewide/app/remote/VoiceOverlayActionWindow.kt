package dev.codewide.app.remote

import android.content.Context
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import kotlin.math.roundToInt

private enum class VoiceOverlayPointer { IDLE, ORB, ACTION, IGNORED }

/** One compact input window: empty space between actions belongs to the application beneath. */
internal class VoiceOverlayActionWindow(
  context: Context,
  private val windowManager: WindowManager,
  val button: VoiceOverlayIconButton,
  size: Int,
  private val isOrbTouch: (Float, Float) -> Boolean,
  private val onOrbTouch: (MotionEvent) -> Boolean,
  private val onOutsideTouch: (Float, Float) -> Unit,
  private val onGestureFinished: () -> Unit,
  private val onWindowDetached: () -> Unit,
) {
  private var pointer = VoiceOverlayPointer.IDLE
  val forwardingOrbGesture: Boolean get() = pointer == VoiceOverlayPointer.ORB
  private var attached = false
  private val params = WindowManager.LayoutParams(
    size,
    size,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
      WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
      WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.LEFT
    // Placement is in absolute display coordinates, including our own safe-area insets.
    setFitInsetsTypes(0)
  }
  private val surface = object : FrameLayout(context) {
    override fun onDetachedFromWindow() {
      super.onDetachedFromWindow()
      if (attached) {
        attached = false
        onWindowDetached()
      }
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
      if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) {
        onOutsideTouch(event.rawX, event.rawY)
        return true
      }
      if (event.actionMasked == MotionEvent.ACTION_DOWN) {
        pointer = when {
          isOrbTouch(event.rawX, event.rawY) -> VoiceOverlayPointer.ORB
          button.isEnabled -> VoiceOverlayPointer.ACTION
          else -> VoiceOverlayPointer.IGNORED
        }
      }
      val handled = when (pointer) {
        // An emerging action may cover part of the orb. Keep that complete gesture with its owner.
        VoiceOverlayPointer.ORB -> onOrbTouch(event)
        VoiceOverlayPointer.ACTION -> super.dispatchTouchEvent(event)
        // A down during reveal must never turn into Stop when reveal finishes before the up.
        VoiceOverlayPointer.IDLE, VoiceOverlayPointer.IGNORED -> true
      }
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
        pointer = VoiceOverlayPointer.IDLE
        onGestureFinished()
      }
      return handled
    }
  }.apply {
    isClickable = true
    setOnClickListener { if (button.isEnabled) button.performClick() }
    addView(button, FrameLayout.LayoutParams(size, size))
  }

  fun attach() {
    windowManager.addView(surface, params)
    attached = true
  }

  fun present(center: OverlayPoint, frame: VoiceOverlayActionFrame, interactive: Boolean) {
    params.x = (center.x - params.width / 2f).roundToInt()
    params.y = (center.y - params.height / 2f).roundToInt()
    // Scale/opacity affect drawing only; the complete 48dp hit target never shrinks.
    button.scaleX = frame.scale
    button.scaleY = frame.scale
    button.alpha = frame.alpha
    button.isEnabled = interactive
    button.importantForAccessibility = if (interactive) View.IMPORTANT_FOR_ACCESSIBILITY_YES else {
      View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    if (attached) windowManager.updateViewLayout(surface, params)
  }

  private val screenPosition = IntArray(2)

  fun contains(x: Float, y: Float): Boolean {
    // LayoutParams are a request. WM may shift the applied frame for display policy/insets.
    surface.getLocationOnScreen(screenPosition)
    return x >= screenPosition[0] && x < screenPosition[0] + surface.width &&
      y >= screenPosition[1] && y < screenPosition[1] + surface.height
  }

  fun dispose() {
    if (!attached) return
    attached = false
    windowManager.removeViewImmediate(surface)
  }
}
