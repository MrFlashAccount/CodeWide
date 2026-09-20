package dev.codewide.app.remote

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

internal data class OverlayPoint(val x: Float, val y: Float)

internal data class OverlaySafeBounds(
  val minX: Float,
  val minY: Float,
  val maxX: Float,
  val maxY: Float,
) {
  fun clamp(point: OverlayPoint): OverlayPoint =
    OverlayPoint(point.x.coerceIn(minX, maxX), point.y.coerceIn(minY, maxY))
}

internal data class OverlayMotionBounds(
  val minX: Float,
  val minY: Float,
  val maxX: Float,
  val maxY: Float,
)

/** Minimal transparent window that contains a complete start-to-target overlay motion. */
internal data class OverlayMotionCorridor(
  val left: Int,
  val top: Int,
  val width: Int,
  val height: Int,
) {
  fun local(point: OverlayPoint): OverlayPoint = OverlayPoint(point.x - left, point.y - top)

  companion object {
    fun between(start: OverlayPoint, target: OverlayPoint, elementSize: Int): OverlayMotionCorridor {
      return containing(
        OverlayMotionBounds(
          minX = min(start.x, target.x),
          minY = min(start.y, target.y),
          maxX = max(start.x, target.x),
          maxY = max(start.y, target.y),
        ),
        elementSize,
      )
    }

    fun containing(bounds: OverlayMotionBounds, elementSize: Int): OverlayMotionCorridor {
      val safeElementSize = elementSize.coerceAtLeast(1)
      val left = floor(bounds.minX).toInt()
      val top = floor(bounds.minY).toInt()
      val right = ceil(bounds.maxX + safeElementSize).toInt()
      val bottom = ceil(bounds.maxY + safeElementSize).toInt()
      return OverlayMotionCorridor(
        left = left,
        top = top,
        width = (right - left).coerceAtLeast(safeElementSize),
        height = (bottom - top).coerceAtLeast(safeElementSize),
      )
    }
  }
}

/** Owns the applied window position and raw-to-window coordinates for one drag gesture. */
internal class OverlayDragCoordinates(initialPosition: OverlayPoint = OverlayPoint(0f, 0f)) {
  var currentPosition: OverlayPoint = initialPosition
    private set
  private var downRaw = OverlayPoint(0f, 0f)
  private var downWindow = initialPosition

  fun updateAppliedPosition(point: OverlayPoint) {
    currentPosition = point
  }

  fun begin(rawPoint: OverlayPoint) {
    downRaw = rawPoint
    downWindow = currentPosition
  }

  fun requestedPosition(rawPoint: OverlayPoint): OverlayPoint = OverlayPoint(
    downWindow.x + rawPoint.x - downRaw.x,
    downWindow.y + rawPoint.y - downRaw.y,
  )
}

/** Reports only real safe-area changes so repeated inset dispatch cannot cancel motion. */
internal class OverlaySafeBoundsTracker(initialBounds: OverlaySafeBounds) {
  var currentBounds: OverlaySafeBounds = initialBounds
    private set

  fun update(bounds: OverlaySafeBounds): Boolean {
    if (bounds == currentBounds) return false
    currentBounds = bounds
    return true
  }
}

internal sealed interface OverlayReleasePlacement {
  val point: OverlayPoint

  data class Free(override val point: OverlayPoint) : OverlayReleasePlacement

  data class Snap(
    override val point: OverlayPoint,
    val target: OverlayPoint,
    val velocity: OverlayPoint,
  ) : OverlayReleasePlacement

  data class Return(
    override val point: OverlayPoint,
    val target: OverlayPoint,
    val velocity: OverlayPoint,
  ) : OverlayReleasePlacement
}

internal object GlobalVoiceOverlayPlacement {
  fun release(
    point: OverlayPoint,
    velocity: OverlayPoint,
    bounds: OverlaySafeBounds,
    snapZoneWidth: Float,
  ): OverlayReleasePlacement {
    val safePoint = bounds.clamp(point)
    val horizontalTravel = (bounds.maxX - bounds.minX).coerceAtLeast(0f)
    val effectiveSnapZone = snapZoneWidth.coerceAtLeast(0f)
      .coerceAtMost(horizontalTravel * MAX_SNAP_ZONE_FRACTION_PER_EDGE)
    val targetX = when {
      safePoint.x <= bounds.minX + effectiveSnapZone -> bounds.minX
      safePoint.x >= bounds.maxX - effectiveSnapZone -> bounds.maxX
      else -> null
    }
    if (targetX != null) {
      val projectedY = bounds.clamp(
        OverlayPoint(safePoint.x, safePoint.y + velocity.y * VELOCITY_PROJECTION_SECONDS),
      ).y
      return OverlayReleasePlacement.Snap(
        point = point,
        target = OverlayPoint(targetX, projectedY),
        velocity = velocity,
      )
    }
    if (point != safePoint) {
      return OverlayReleasePlacement.Return(
        point = point,
        target = safePoint,
        velocity = velocity,
      )
    }
    return OverlayReleasePlacement.Free(safePoint)
  }

  fun drag(point: OverlayPoint, bounds: OverlaySafeBounds, overscroll: Float): OverlayPoint {
    val allowance = overscroll.coerceAtLeast(0f)
    return OverlayPoint(
      point.x.coerceIn(bounds.minX - allowance, bounds.maxX + allowance),
      point.y.coerceIn(bounds.minY - allowance, bounds.maxY + allowance),
    )
  }

  fun normalize(point: OverlayPoint, bounds: OverlaySafeBounds): OverlayPoint {
    val width = (bounds.maxX - bounds.minX).coerceAtLeast(1f)
    val height = (bounds.maxY - bounds.minY).coerceAtLeast(1f)
    val safePoint = bounds.clamp(point)
    return OverlayPoint(
      (safePoint.x - bounds.minX) / width,
      (safePoint.y - bounds.minY) / height,
    )
  }

  fun restore(normalized: OverlayPoint, bounds: OverlaySafeBounds): OverlayPoint =
    bounds.clamp(
      OverlayPoint(
        bounds.minX + normalized.x.coerceIn(0f, 1f) * (bounds.maxX - bounds.minX),
        bounds.minY + normalized.y.coerceIn(0f, 1f) * (bounds.maxY - bounds.minY),
      ),
    )

  private const val VELOCITY_PROJECTION_SECONDS = 0.12f
  private const val MAX_SNAP_ZONE_FRACTION_PER_EDGE = 0.2f
}

/** Critically damped trajectory whose derivative at time zero equals the release velocity. */
internal class OverlaySnapTrajectory(
  private val start: OverlayPoint,
  private val target: OverlayPoint,
  private val velocity: OverlayPoint,
  private val angularFrequency: Float = 15f,
) {
  fun pointAt(elapsedSeconds: Float): OverlayPoint = OverlayPoint(
    axis(start.x, target.x, velocity.x, elapsedSeconds),
    axis(start.y, target.y, velocity.y, elapsedSeconds),
  )

  fun motionBounds(elapsedSeconds: Float): OverlayMotionBounds {
    val x = axisBounds(start.x, target.x, velocity.x, elapsedSeconds)
    val y = axisBounds(start.y, target.y, velocity.y, elapsedSeconds)
    return OverlayMotionBounds(x.first, y.first, x.second, y.second)
  }

  private fun axis(start: Float, target: Float, velocity: Float, elapsedSeconds: Float): Float {
    val time = elapsedSeconds.coerceAtLeast(0f)
    val delta = start - target
    return target + (delta + (velocity + angularFrequency * delta) * time) *
      exp(-angularFrequency * time)
  }

  private fun axisBounds(
    start: Float,
    target: Float,
    velocity: Float,
    elapsedSeconds: Float,
  ): Pair<Float, Float> {
    val duration = elapsedSeconds.coerceAtLeast(0f)
    val end = axis(start, target, velocity, duration)
    var minimum = minOf(start, target, end)
    var maximum = maxOf(start, target, end)
    val coefficient = velocity + angularFrequency * (start - target)
    if (coefficient != 0f) {
      val extremumTime = velocity / (angularFrequency * coefficient)
      if (extremumTime > 0f && extremumTime < duration) {
        val extremum = axis(start, target, velocity, extremumTime)
        minimum = min(minimum, extremum)
        maximum = max(maximum, extremum)
      }
    }
    return minimum to maximum
  }
}

internal enum class OverlayGestureResult { DRAG, TAP }

internal class OverlayGestureThreshold(private val touchSlop: Float) {
  private var down = OverlayPoint(0f, 0f)
  private var dragging = false

  fun begin(point: OverlayPoint) {
    down = point
    dragging = false
  }

  fun move(point: OverlayPoint): Boolean {
    if (!dragging) {
      dragging = hypot(point.x - down.x, point.y - down.y) > touchSlop
    }
    return dragging
  }

  fun finish(): OverlayGestureResult =
    if (dragging) OverlayGestureResult.DRAG else OverlayGestureResult.TAP
}
