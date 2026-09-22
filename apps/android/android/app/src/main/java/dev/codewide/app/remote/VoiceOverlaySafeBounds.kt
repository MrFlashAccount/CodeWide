package dev.codewide.app.remote

import android.view.WindowInsets

/** Bounds for the complete window, including visible IME and reserved system gesture regions. */
internal fun voiceOverlaySafeBounds(
  displayWidth: Int,
  displayHeight: Int,
  insets: WindowInsets,
  elementWidth: Int,
  elementHeight: Int,
  margin: Float,
): OverlaySafeBounds {
  val reserved = insets.getInsetsIgnoringVisibility(
    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.systemGestures(),
  )
  val keyboard = insets.getInsets(WindowInsets.Type.ime())
  val minX = maxOf(reserved.left, keyboard.left) + margin
  val minY = maxOf(reserved.top, keyboard.top) + margin
  return OverlaySafeBounds(
    minX, minY,
    (displayWidth - maxOf(reserved.right, keyboard.right) - elementWidth - margin).coerceAtLeast(minX),
    (displayHeight - maxOf(reserved.bottom, keyboard.bottom) - elementHeight - margin).coerceAtLeast(minY),
  )
}
