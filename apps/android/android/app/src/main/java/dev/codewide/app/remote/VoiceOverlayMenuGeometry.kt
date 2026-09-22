package dev.codewide.app.remote

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

internal data class VoiceOverlayMenuGeometry(
  val centers: List<OverlayPoint>,
  val orbCenter: OverlayPoint,
  val buttonSize: Int,
)

/** Rigid semicircle: rotate first, then translate the complete orb/fan into the safe area. */
internal fun voiceOverlayMenuGeometry(
  center: OverlayPoint,
  safe: OverlaySafeBounds,
  density: Float,
): VoiceOverlayMenuGeometry? {
  val radius = 88f * density
  val buttonSize = (48f * density).toInt()
  val half = buttonSize / 2f
  val orbHalf = 38f * density
  val clearance = 8f * density
  val padding = 4f * density
  val direction = when {
    center.x - safe.minX < radius + half -> 0f
    safe.maxX - center.x < radius + half -> PI.toFloat()
    else -> -PI.toFloat() / 2f
  }
  var best: VoiceOverlayMenuGeometry? = null
  var bestDistance = Float.POSITIVE_INFINITY
  for (step in 0..71) {
    val offset = ((step + 1) / 2) * (if (step % 2 == 0) -1 else 1) * PI.toFloat() / 36f
    val angle = direction + offset
    val offsets = (0..4).map { index ->
      val bearing = angle + (index - 2) * PI.toFloat() / 4f
      OverlayPoint(radius * cos(bearing), radius * sin(bearing))
    }
    // Independent square input windows must not overlap even when the whole arc rotates.
    if (offsets.indices.any { index ->
        (index + 1 until offsets.size).any { other ->
          abs(offsets[index].x - offsets[other].x) < buttonSize + clearance - 0.01f &&
            abs(offsets[index].y - offsets[other].y) < buttonSize + clearance - 0.01f
        }
      }) continue
    if (offsets.any { abs(it.x) < half + orbHalf && abs(it.y) < half + orbHalf }) continue
    val excursion = VoiceOverlayMenuMotion.MAX_TRAVEL
    val left = minOf(-orbHalf, offsets.minOf { it.x * excursion - half - padding })
    val right = maxOf(orbHalf, offsets.maxOf { it.x * excursion + half + padding })
    val top = minOf(-orbHalf, offsets.minOf { it.y * excursion - half - padding })
    val bottom = maxOf(orbHalf, offsets.maxOf { it.y * excursion + half + padding })
    val minX = safe.minX - left
    val maxX = safe.maxX - right
    val minY = safe.minY - top
    val maxY = safe.maxY - bottom
    if (minX > maxX || minY > maxY) continue
    val orb = OverlayPoint(center.x.coerceIn(minX, maxX), center.y.coerceIn(minY, maxY))
    val dx = orb.x - center.x
    val dy = orb.y - center.y
    val distance = dx * dx + dy * dy
    if (distance >= bestDistance) continue
    best = VoiceOverlayMenuGeometry(
      offsets.map { OverlayPoint(orb.x + it.x, orb.y + it.y) }, orb, buttonSize,
    )
    if (distance == 0f) return best
    bestDistance = distance
  }
  return best
}
