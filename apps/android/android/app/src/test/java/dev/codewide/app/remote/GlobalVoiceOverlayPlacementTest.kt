package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlobalVoiceOverlayPlacementTest {
  private val bounds = OverlaySafeBounds(minX = 10f, minY = 20f, maxX = 290f, maxY = 580f)

  @Test
  fun releaseOutsideSnapZoneKeepsFreePlacement() {
    val placement = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint(140f, 240f),
      velocity = OverlayPoint(420f, -120f),
      bounds = bounds,
      snapZoneWidth = 48f,
    )

    assertTrue(placement is OverlayReleasePlacement.Free)
    assertEquals(OverlayPoint(140f, 240f), placement.point)
  }

  @Test
  fun narrowScreensStillKeepARealFreePlacementRegion() {
    val narrowBounds = OverlaySafeBounds(minX = 10f, minY = 20f, maxX = 90f, maxY = 580f)

    val placement = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint(50f, 240f),
      velocity = OverlayPoint(0f, 0f),
      bounds = narrowBounds,
      snapZoneWidth = 48f,
    )

    assertTrue(placement is OverlayReleasePlacement.Free)
    assertEquals(OverlayPoint(50f, 240f), placement.point)
  }

  @Test
  fun productionSizedPhoneKeepsEverythingOutsideTheEdgeZonesFree() {
    val density = 3f
    val safeMargin = 8f * density
    val overlaySize = 76f * density
    val phoneBounds = OverlaySafeBounds(
      minX = safeMargin,
      minY = safeMargin,
      maxX = 1_080f - overlaySize - safeMargin,
      maxY = 2_400f - overlaySize - safeMargin,
    )
    val snapZone = 16f * density

    val justOutsideLeftZone = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint(phoneBounds.minX + snapZone + 1f, 600f),
      velocity = OverlayPoint(0f, 0f),
      bounds = phoneBounds,
      snapZoneWidth = snapZone,
    )
    val center = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint((phoneBounds.minX + phoneBounds.maxX) / 2f, 600f),
      velocity = OverlayPoint(2_000f, 0f),
      bounds = phoneBounds,
      snapZoneWidth = snapZone,
    )
    val justOutsideRightZone = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint(phoneBounds.maxX - snapZone - 1f, 600f),
      velocity = OverlayPoint(0f, 0f),
      bounds = phoneBounds,
      snapZoneWidth = snapZone,
    )

    assertTrue(justOutsideLeftZone is OverlayReleasePlacement.Free)
    assertTrue(center is OverlayReleasePlacement.Free)
    assertTrue(justOutsideRightZone is OverlayReleasePlacement.Free)
  }

  @Test
  fun releaseUsesTheLastAppliedWindowPositionInsteadOfTheGestureOrigin() {
    val coordinates = OverlayDragCoordinates(OverlayPoint(290f, 240f))
    coordinates.begin(OverlayPoint(800f, 400f))
    assertEquals(
      OverlayPoint(140f, 240f),
      coordinates.requestedPosition(OverlayPoint(650f, 400f)),
    )

    coordinates.updateAppliedPosition(OverlayPoint(140f, 240f))

    assertEquals(OverlayPoint(140f, 240f), coordinates.currentPosition)
    val placement = GlobalVoiceOverlayPlacement.release(
      point = coordinates.currentPosition,
      velocity = OverlayPoint(0f, 0f),
      bounds = bounds,
      snapZoneWidth = 48f,
    )
    assertTrue(placement is OverlayReleasePlacement.Free)
  }

  @Test
  fun releaseInSnapZoneCarriesGestureVelocityIntoAnimation() {
    val placement = GlobalVoiceOverlayPlacement.release(
      point = OverlayPoint(272f, 240f),
      velocity = OverlayPoint(900f, 300f),
      bounds = bounds,
      snapZoneWidth = 48f,
    ) as OverlayReleasePlacement.Snap
    val trajectory = OverlaySnapTrajectory(placement.point, placement.target, placement.velocity)
    val firstFrame = trajectory.pointAt(0.001f)

    assertEquals(bounds.maxX, placement.target.x, 0f)
    assertTrue(firstFrame.x > placement.point.x)
    assertTrue(firstFrame.y > placement.point.y)
  }

  @Test
  fun snapSpringHasVisibleIntermediateFramesBeforeItSettles() {
    val trajectory = OverlaySnapTrajectory(
      start = OverlayPoint(258f, 240f),
      target = OverlayPoint(bounds.maxX, 240f),
      velocity = OverlayPoint(0f, 0f),
    )

    val firstDisplayFrame = trajectory.pointAt(1f / 60f)
    val laterFrame = trajectory.pointAt(0.2f)
    val settled = trajectory.pointAt(0.55f)

    assertTrue(firstDisplayFrame.x > 258f)
    assertTrue(firstDisplayFrame.x < bounds.maxX)
    assertTrue(laterFrame.x > firstDisplayFrame.x)
    assertEquals(bounds.maxX, settled.x, 0.2f)
  }

  @Test
  fun motionCorridorContainsEveryFrameWithoutAFullScreenOverlay() {
    val start = OverlayPoint(258f, 240f)
    val target = OverlayPoint(290f, 260f)
    val corridor = OverlayMotionCorridor.between(start, target, elementSize = 76)

    assertEquals(258, corridor.left)
    assertEquals(240, corridor.top)
    assertEquals(108, corridor.width)
    assertEquals(96, corridor.height)
    assertEquals(OverlayPoint(0f, 0f), corridor.local(start))
    assertEquals(OverlayPoint(32f, 20f), corridor.local(target))
  }

  @Test
  fun motionCorridorIncludesVelocityOvershootWithoutClippingTheOrb() {
    val trajectory = OverlaySnapTrajectory(
      start = OverlayPoint(258f, 240f),
      target = OverlayPoint(290f, 260f),
      velocity = OverlayPoint(1_600f, -900f),
    )
    val corridor = OverlayMotionCorridor.containing(
      trajectory.motionBounds(0.55f),
      elementSize = 76,
    )

    for (frame in 0..33) {
      val point = corridor.local(trajectory.pointAt(frame / 60f))
      assertTrue(point.x >= 0f)
      assertTrue(point.y >= 0f)
      assertTrue(point.x + 76f <= corridor.width)
      assertTrue(point.y + 76f <= corridor.height)
    }
  }

  @Test
  fun normalizedFreePlacementSurvivesRotationAndNewInsets() {
    val normalized = GlobalVoiceOverlayPlacement.normalize(OverlayPoint(150f, 300f), bounds)
    val rotatedBounds = OverlaySafeBounds(minX = 30f, minY = 10f, maxX = 700f, maxY = 310f)
    val restored = GlobalVoiceOverlayPlacement.restore(normalized, rotatedBounds)

    assertTrue(restored.x in rotatedBounds.minX..rotatedBounds.maxX)
    assertTrue(restored.y in rotatedBounds.minY..rotatedBounds.maxY)
    assertEquals(0.5f, normalized.x, 0.001f)
    assertEquals(0.5f, normalized.y, 0.001f)
  }

  @Test
  fun overscrolledDragReturnsThroughTheSpringInsteadOfTeleporting() {
    val dragged = GlobalVoiceOverlayPlacement.drag(
      point = OverlayPoint(150f, -80f),
      bounds = bounds,
      overscroll = 24f,
    )
    val placement = GlobalVoiceOverlayPlacement.release(
      point = dragged,
      velocity = OverlayPoint(120f, -300f),
      bounds = bounds,
      snapZoneWidth = 48f,
    ) as OverlayReleasePlacement.Return
    val trajectory = OverlaySnapTrajectory(placement.point, placement.target, placement.velocity)

    assertEquals(OverlayPoint(150f, -4f), placement.point)
    assertEquals(OverlayPoint(150f, bounds.minY), placement.target)
    assertEquals(placement.point, trajectory.pointAt(0f))
    assertTrue(trajectory.pointAt(0.001f).y < placement.target.y)
  }

  @Test
  fun launchHandoffStartsAtTheMeasuredHeaderOriginAndSettlesAtTheFloatingPosition() {
    val headerOrigin = OverlayPoint(300f, 80f)
    val floatingTarget = OverlayPoint(920f, 240f)
    val trajectory = OverlaySnapTrajectory(
      start = headerOrigin,
      target = floatingTarget,
      velocity = OverlayPoint(0f, 0f),
    )

    assertEquals(headerOrigin, trajectory.pointAt(0f))
    val moving = trajectory.pointAt(0.1f)
    assertTrue(moving.x in headerOrigin.x..floatingTarget.x)
    assertTrue(moving.y in headerOrigin.y..floatingTarget.y)
    val settled = trajectory.pointAt(1f)
    assertEquals(floatingTarget.x, settled.x, 0.1f)
    assertEquals(floatingTarget.y, settled.y, 0.1f)
  }

  @Test
  fun tapAndDragRemainMutuallyExclusiveAtTouchSlop() {
    val gesture = OverlayGestureThreshold(touchSlop = 12f)
    gesture.begin(OverlayPoint(100f, 100f))
    gesture.move(OverlayPoint(107f, 106f))
    assertEquals(OverlayGestureResult.TAP, gesture.finish())

    gesture.begin(OverlayPoint(100f, 100f))
    gesture.move(OverlayPoint(120f, 100f))
    assertEquals(OverlayGestureResult.DRAG, gesture.finish())
  }
}
