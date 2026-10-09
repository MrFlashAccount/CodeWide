package dev.codewide.app.input

import android.os.SystemClock
import android.view.MotionEvent
import java.lang.reflect.Method

/** Isolates the one non-SDK operation Chromium needs for real mouse button events. */
internal object DesktopMouseEventButtons {
  // WHY: MotionEvent.obtain exposes buttonState but not actionButton. Chromium ignores
  // DOWN/UP for DOM button transitions and needs PRESS/RELEASE with actionButton.
  // AOSP currently lists this public Java method as unsupported (not blocked). Probe
  // both lookup and invocation; do not advertise the mode when firmware denies it.
  private val setter: Method? = resolve()
  val available: Boolean get() = setter != null

  fun apply(event: MotionEvent, button: Int): Boolean {
    val method = setter ?: return false
    return try {
      method.invoke(event, button)
      event.actionButton == button
    } catch (_: ReflectiveOperationException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private fun resolve(): Method? {
    val time = SystemClock.uptimeMillis()
    val event = MotionEvent.obtain(time, time, MotionEvent.ACTION_BUTTON_PRESS, 0f, 0f, 0)
    return try {
      val method = MotionEvent::class.java.getMethod("setActionButton", Int::class.javaPrimitiveType)
      method.invoke(event, MotionEvent.BUTTON_PRIMARY)
      if (event.actionButton == MotionEvent.BUTTON_PRIMARY) method else null
    } catch (_: ReflectiveOperationException) {
      null
    } catch (_: SecurityException) {
      null
    } finally {
      event.recycle()
    }
  }
}
