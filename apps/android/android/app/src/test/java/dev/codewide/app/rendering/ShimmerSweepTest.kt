package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShimmerSweepTest {
  @Test
  fun wrappingRequiresWiderGradientChildToReachTheTopLines() {
    val beforeWrapping = ShimmerSweep(300f, 240f, false, 28f)
    val wrapped = ShimmerSweep(300f, 240f, true, 28f)
    val topPhase = phaseAtPeak(wrapped, 40f, 0f)
    val translation = wrapped.startX + (wrapped.endX - wrapped.startX) * topPhase
    val illuminatedChildX = 40f - translation
    // Reusing the pre-wrap child clips the highlight on the upper lines,
    // although the gradient's phase correctly covers the whole paragraph.
    assertTrue(illuminatedChildX > beforeWrapping.viewWidth)
    assertTrue(illuminatedChildX in 0f..wrapped.viewWidth)
  }

  @Test
  fun singleLinePreservesHorizontalSweepAcrossEveryGlyph() {
    val sweep = ShimmerSweep(200f, 24f, false, 28f)
    assertEquals(0f, sweep.gradientStartX, 0f)
    assertEquals(0f, sweep.gradientEndY, 0f)
    assertEquals(92f, sweep.viewWidth, 0.001f)
    assertEquals(-92f, sweep.startX, 0.001f)
    assertEquals(200f, sweep.endX, 0f)
    assertEquals(phaseAtPeak(sweep, 50f, 0f), phaseAtPeak(sweep, 50f, 24f), 0f)
  }

  @Test
  fun multilineUsesOneDiagonalFieldRatherThanRestartingOnEachLine() {
    val sweep = ShimmerSweep(300f, 120f, true, 28f)
    assertTrue(phaseAtPeak(sweep, 40f, 20f) < phaseAtPeak(sweep, 40f, 100f))
    assertEquals(phaseAtPeak(sweep, 40f, 100f), phaseAtPeak(sweep, 120f, 20f), 0.0001f)
  }

  @Test
  fun everyLineAndCornerIsReachedWithoutClippingTheSlantedBand() {
    for ((width, height) in listOf(300f to 120f, 80f to 900f, 1f to 24f)) {
      val sweep = ShimmerSweep(width, height, true, 28f)
      for (row in 0..12) {
        for (column in 0..4) {
          val x = width * column / 4f
          val y = height * row / 12f
          val phase = phaseAtPeak(sweep, x, y)
          assertTrue("The sweep must reach every part of the paragraph", phase in 0f..1f)
          val translation = sweep.startX + (sweep.endX - sweep.startX) * phase
          assertTrue("The gradient child must cover the illuminated glyph", x - translation in -0.001f..(sweep.viewWidth + 0.001f))
        }
      }
      assertTrue(phaseAtPeak(sweep, 0f, 0f) < phaseAtPeak(sweep, width, height))
    }
  }

  // Solve the LinearGradient dot-product equation at its highlight (t = 0.5).
  private fun phaseAtPeak(sweep: ShimmerSweep, x: Float, y: Float): Float {
    val dx = sweep.gradientEndX - sweep.gradientStartX
    val dy = sweep.gradientEndY
    val translation = x - sweep.gradientStartX + y * dy / dx - (dx * dx + dy * dy) / (2f * dx)
    return (translation - sweep.startX) / (sweep.endX - sweep.startX)
  }
}
