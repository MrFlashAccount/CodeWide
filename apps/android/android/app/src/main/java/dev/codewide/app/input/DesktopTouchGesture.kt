package dev.codewide.app.input

import kotlin.math.hypot

internal sealed interface DesktopTouchAction {
  data class Move(val dx: Float, val dy: Float) : DesktopTouchAction
  data class Scroll(val dx: Float, val dy: Float) : DesktopTouchAction
  data class Click(val button: Int) : DesktopTouchAction
  data object DragStart : DesktopTouchAction
  data object DragEnd : DesktopTouchAction
}

/** Relative touchpad interpretation without Android or browser lifecycle dependencies. */
internal class DesktopTouchGesture(
  private val slop: Float,
  private val tapTimeout: Long,
  private val emit: (DesktopTouchAction) -> Unit,
) {
  private var active = false
  private var x = 0f
  private var y = 0f
  private var fingers = 0
  private var maximumFingers = 0
  private var started = 0L
  private var travel = 0f
  private var dragging = false
  private var dragged = false

  fun start(x: Float, y: Float, time: Long) {
    cancel()
    active = true
    this.x = x
    this.y = y
    fingers = 1
    maximumFingers = 1
    started = time
    travel = 0f
    dragged = false
  }

  fun changeFingers(x: Float, y: Float, count: Int) {
    if (!active) return
    if (dragging) { dragging = false; emit(DesktopTouchAction.DragEnd) }
    this.x = x
    this.y = y
    fingers = count
    maximumFingers = maxOf(maximumFingers, count)
  }

  fun move(x: Float, y: Float) {
    if (!active) return
    val dx = x - this.x
    val dy = y - this.y
    this.x = x
    this.y = y
    travel += hypot(dx, dy)
    if (fingers == 1) emit(DesktopTouchAction.Move(dx, dy))
    else if (fingers == 2) emit(DesktopTouchAction.Scroll(dx, dy))
  }

  fun hold() {
    if (!active || fingers != 1 || maximumFingers != 1 || travel > slop || dragging) return
    dragging = true
    dragged = true
    emit(DesktopTouchAction.DragStart)
  }

  fun end(time: Long) {
    if (!active) return
    active = false
    if (dragging) { dragging = false; emit(DesktopTouchAction.DragEnd) }
    else if (!dragged && travel <= slop && time - started <= tapTimeout) {
      val button = when (maximumFingers) { 1 -> 1; 2 -> 2; 3 -> 4; else -> 0 }
      if (button != 0) emit(DesktopTouchAction.Click(button))
    }
  }

  fun cancel() {
    active = false
    if (dragging) { dragging = false; emit(DesktopTouchAction.DragEnd) }
  }
}
