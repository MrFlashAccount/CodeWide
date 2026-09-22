package dev.codewide.app.remote

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.atan2
import kotlin.math.PI
import org.junit.Assert.*
import org.junit.Test

class VoiceOverlayMenuGeometryTest {
  @Test fun fansFitEdgesCornersFreePositionsAndKeyboardConstrainedLandscape() {
    for (density in listOf(1f, 1.5f, 2f, 3f)) {
      for ((width, height) in listOf(360f to 800f, 800f to 360f, 640f to 260f, 360f to 300f)) {
        val safe = OverlaySafeBounds(8f * density, 32f * density, (width - 8) * density, (height - 32) * density)
        val orbHalf = 38f * density
        val xs = listOf(safe.minX + orbHalf, width / 2 * density, safe.maxX - orbHalf)
        val ys = listOf(safe.minY + orbHalf, height / 2 * density, safe.maxY - orbHalf)
        for (x in xs) for (y in ys) {
          val layout = requireNotNull(voiceOverlayMenuGeometry(OverlayPoint(x, y), safe, density)) {
            "No layout at $x,$y in ${width}x$height at $density"
          }
          assertEquals(5, layout.centers.size)
          assertTrue(layout.buttonSize >= 48f * density)
          val half = layout.buttonSize / 2f
          val orb = layout.orbCenter
          assertTrue(orb.x - orbHalf >= safe.minX && orb.x + orbHalf <= safe.maxX)
          assertTrue(orb.y - orbHalf >= safe.minY && orb.y + orbHalf <= safe.maxY)
          for ((index, point) in layout.centers.withIndex()) {
            assertEquals(88f * density, hypot(point.x - orb.x, point.y - orb.y), 0.002f * density)
            assertTrue(abs(point.x - orb.x) >= half + orbHalf || abs(point.y - orb.y) >= half + orbHalf)
            if (index > 0) {
              val previous = layout.centers[index - 1]
              val angle = atan2(point.y - orb.y, point.x - orb.x)
              val before = atan2(previous.y - orb.y, previous.x - orb.x)
              val delta = (angle - before + 2f * PI.toFloat()) % (2f * PI.toFloat())
              assertEquals(PI.toFloat() / 4f, delta, 0.0001f)
            }
            for (travel in listOf(1f, VoiceOverlayMenuMotion.MAX_TRAVEL)) {
              val px = orb.x + (point.x - orb.x) * travel
              val py = orb.y + (point.y - orb.y) * travel
              assertTrue(px - half >= safe.minX && px + half <= safe.maxX)
              assertTrue(py - half >= safe.minY && py + half <= safe.maxY)
            }
            for (other in layout.centers.drop(index + 1)) {
              assertTrue(abs(point.x - other.x) >= layout.buttonSize + 8f * density - 0.02f ||
                abs(point.y - other.y) >= layout.buttonSize + 8f * density - 0.02f)
            }
          }
        }
      }
    }
  }

  @Test fun unobstructedCenterPrefersUpAndEdgesPreferInward() {
    val safe = OverlaySafeBounds(8f, 32f, 392f, 768f)
    val central = requireNotNull(voiceOverlayMenuGeometry(OverlayPoint(200f, 400f), safe, 1f))
    assertEquals(OverlayPoint(200f, 400f), central.orbCenter)
    assertTrue(central.centers.all { it.y <= 400.01f })
    val left = requireNotNull(voiceOverlayMenuGeometry(OverlayPoint(46f, 400f), safe, 1f))
    assertTrue(left.centers.all { it.x >= 45.99f })
    val right = requireNotNull(voiceOverlayMenuGeometry(OverlayPoint(354f, 400f), safe, 1f))
    assertTrue(right.centers.all { it.x <= 354.01f })
  }

  @Test fun impossibleBoundsNeverProduceClippedOrShrunkenButtons() {
    assertNull(voiceOverlayMenuGeometry(OverlayPoint(40f, 40f), OverlaySafeBounds(0f, 0f, 80f, 80f), 1f))
    // A rigid 88dp semicircle cannot fit a 136dp-high keyboard remainder. Never replace
    // it with unrelated per-button positions just to keep the menu attached.
    assertNull(voiceOverlayMenuGeometry(OverlayPoint(320f, 100f), OverlaySafeBounds(8f, 32f, 632f, 168f), 1f))
  }

  @Test fun timelineStaggersAndSettlesWithinTheReservedSpringBounds() {
    assertEquals(0f, VoiceOverlayMenuMotion.frame(0f, 0).alpha, 0f)
    assertTrue(VoiceOverlayMenuMotion.frame(0.15f, 0).travel > VoiceOverlayMenuMotion.frame(0.15f, 2).travel)
    var overshot = false
    for (step in 0..400) for (index in 0..4) {
      val frame = VoiceOverlayMenuMotion.frame(step / 300f, index)
      assertTrue(frame.travel >= -0.0001f && frame.travel <= VoiceOverlayMenuMotion.MAX_TRAVEL)
      assertTrue(frame.alpha in 0f..1f)
      overshot = overshot || frame.travel > 1f
    }
    assertTrue(overshot)
    for (index in 0..4) {
      val settled = VoiceOverlayMenuMotion.frame(1f, index)
      assertEquals(1f, settled.travel, 0f)
      assertEquals(1f, settled.alpha, 0f)
      assertEquals(1f, settled.scale, 0f)
    }
  }
}
