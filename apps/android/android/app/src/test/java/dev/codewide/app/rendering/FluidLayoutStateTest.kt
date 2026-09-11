package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Test

class FluidLayoutStateTest {
  @Test fun growthStartsAtPreviousGeometry() {
    val start = fluidLayoutStart(100, 140, 80, 0f, null)
    assertEquals(-40f, start.translation, 0f)
    assertEquals(80f, start.visibleHeight, 0f)
  }

  @Test fun rapidUpdatesRetargetTheVisibleFrame() {
    val start = fluidLayoutStart(140, 170, 120, -20f, 96)
    assertEquals(120f, 170 + start.translation, 0f)
    assertEquals(96f, start.visibleHeight, 0f)
  }

  @Test fun shrinkingPreservesVisualOriginWithoutScaling() {
    val start = fluidLayoutStart(170, 100, 120, 0f, null)
    assertEquals(170f, 100 + start.translation, 0f)
    assertEquals(120f, start.visibleHeight, 0f)
  }
}
