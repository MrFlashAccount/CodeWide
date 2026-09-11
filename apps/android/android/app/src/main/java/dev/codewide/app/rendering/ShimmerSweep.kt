package dev.codewide.app.rendering

import kotlin.math.max

/** One gradient field over the entire text rectangle, not a phase per line. */
internal class ShimmerSweep(width: Float, height: Float, multiline: Boolean, minimumBandWidth: Float) {
  private val slope = if (multiline) 1f else 0f
  private val bandWidth = max(minimumBandWidth, width * 0.46f)
  val gradientStartX = height * slope
  val gradientEndX = gradientStartX + bandWidth / (1f + slope * slope)
  val gradientEndY = bandWidth * slope / (1f + slope * slope)
  // The slanted band must still cover the bottom line when its top is offscreen.
  val viewWidth = bandWidth + gradientStartX
  val startX = -viewWidth
  val endX = width
}
