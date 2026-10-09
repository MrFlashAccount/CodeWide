package dev.codewide.app.input

import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView

/** Delivers input only to the attached WebView, never through system-wide injection or CDP. */
internal class DesktopInputDispatcher(val target: WebView, private val unavailable: () -> Unit) {
  val pointer = DesktopPointerState(::sendPointer)
  private var heldModifiers = 0
  private var mouseDownTime = 0L
  private var failed = false

  fun setModifiers(mask: Int) {
    require(mask in 0..7)
    updateModifiers(heldModifiers, mask)
    heldModifiers = mask
  }

  fun key(keyCode: Int, mask: Int) {
    require(mask in 0..7)
    val temporary = heldModifiers or mask
    updateModifiers(heldModifiers, temporary)
    sendKey(keyCode, true, temporary)
    sendKey(keyCode, false, temporary)
    updateModifiers(temporary, heldModifiers)
  }

  fun keyboard() {
    target.requestFocus()
    val keyboard = target.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    keyboard?.showSoftInput(target, InputMethodManager.SHOW_IMPLICIT)
  }

  fun release() { pointer.release(); setModifiers(0) }

  private fun updateModifiers(before: Int, after: Int) {
    for ((bit, code) in MODIFIERS) {
      if (before and bit != 0 && after and bit == 0) sendKey(code, false, after)
    }
    for ((bit, code) in MODIFIERS) {
      if (before and bit == 0 && after and bit != 0) sendKey(code, true, after)
    }
  }

  private fun sendKey(code: Int, down: Boolean, mask: Int) {
    if (!target.isAttachedToWindow) return
    if (down) target.requestFocus()
    val time = SystemClock.uptimeMillis()
    target.dispatchKeyEvent(KeyEvent(time, time, if (down) KeyEvent.ACTION_DOWN else KeyEvent.ACTION_UP,
      code, 0, metaState(mask), KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD))
  }

  private fun sendPointer(frame: DesktopPointerFrame) {
    if (failed || !target.isAttachedToWindow) return
    val action = when (frame.action) {
      DesktopPointerAction.DOWN -> MotionEvent.ACTION_DOWN
      DesktopPointerAction.PRESS -> MotionEvent.ACTION_BUTTON_PRESS
      DesktopPointerAction.MOVE -> MotionEvent.ACTION_MOVE
      DesktopPointerAction.HOVER -> MotionEvent.ACTION_HOVER_MOVE
      DesktopPointerAction.SCROLL -> MotionEvent.ACTION_SCROLL
      DesktopPointerAction.RELEASE -> MotionEvent.ACTION_BUTTON_RELEASE
      DesktopPointerAction.UP -> MotionEvent.ACTION_UP
    }
    val time = SystemClock.uptimeMillis()
    if (frame.action == DesktopPointerAction.DOWN) { mouseDownTime = time; target.requestFocus() }
    val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_MOUSE }
    val coordinates = MotionEvent.PointerCoords().apply {
      x = frame.x
      y = frame.y
      pressure = if (frame.buttons == 0) 0f else 1f
      setAxisValue(MotionEvent.AXIS_HSCROLL, frame.horizontalScroll)
      setAxisValue(MotionEvent.AXIS_VSCROLL, frame.verticalScroll)
    }
    val event = MotionEvent.obtain(mouseDownTime, time, action, 1, arrayOf(properties), arrayOf(coordinates),
      metaState(heldModifiers), frame.buttons, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0)
    try {
      if (frame.changedButton != 0 && !DesktopMouseEventButtons.apply(event, frame.changedButton)) {
        failed = true
        unavailable()
        return
      }
      when (frame.action) {
        DesktopPointerAction.DOWN, DesktopPointerAction.MOVE, DesktopPointerAction.UP -> target.dispatchTouchEvent(event)
        else -> target.dispatchGenericMotionEvent(event)
      }
    } finally { event.recycle() }
  }

  private fun metaState(mask: Int): Int =
    (if (mask and 1 != 0) KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON else 0) or
      (if (mask and 2 != 0) KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON else 0) or
      (if (mask and 4 != 0) KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON else 0)

  private companion object {
    val MODIFIERS = arrayOf(1 to KeyEvent.KEYCODE_CTRL_LEFT, 2 to KeyEvent.KEYCODE_SHIFT_LEFT, 4 to KeyEvent.KEYCODE_ALT_LEFT)
  }
}
