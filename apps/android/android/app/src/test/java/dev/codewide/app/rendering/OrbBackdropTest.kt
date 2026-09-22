package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OrbBackdropTest {
  @Test fun visualRadiusAndSmallPaddingDetermineBackdropNotHitArea() {
    val radius = OrbBackdropRadius()
    assertEquals(23f, radius.update(20f, 3f, 0f, false), 0.001f)
    repeat(120) { radius.update(10f, 3f, 1f / 60, false) }
    assertEquals(13f, radius.value, 0.001f)
    // Nebula's shader fills a 66dp disc; its radius is independent of the 76dp window.
    assertEquals(36f, radius.update(33f, 3f, 0f, true), 0.001f)
  }

  @Test fun sampleSpikeDoesNotSnapBackdropButSustainedGrowthConverges() {
    val radius = OrbBackdropRadius()
    radius.update(10f, 3f, 0f, false)
    val spike = radius.update(20f, 3f, 1f / 60, false)
    assertTrue(spike > 13f && spike < 14f)
    repeat(120) { radius.update(20f, 3f, 1f / 60, false) }
    assertEquals(23f, radius.value, 0.001f)
  }

  @Test fun particleBoundsFollowActualProjectionThroughContractionAndExpansion() {
    val points = ParticlesOrbModel.buildSphere()
    val simulation = ParticlesOrbSimulation()
    val projected = MutableParticlesOrbProjection()
    fun radius(state: VoiceAssistantOrbState, level: Float): Float {
      var frame = simulation.advance(state, level, level, 0f)
      repeat(120) { frame = simulation.advance(state, level, level, 1f / 60) }
      var extent = 0f
      for (index in points.indices) {
        ParticlesOrbModel.projectInto(points[index], index, frame, 66f, 1f, projected)
        extent = maxOf(extent, ParticlesOrbModel.visualExtent(projected, 66f))
      }
      val backdrop = OrbBackdropRadius().update(extent, 3f, 0f, true)
      assertEquals(extent + 3f, backdrop, 0.001f)
      return backdrop
    }
    val idle = radius(VoiceAssistantOrbState.IDLE, 0f)
    val thinking = radius(VoiceAssistantOrbState.THINKING, 0f)
    val speaking = radius(VoiceAssistantOrbState.SPEAKING, 0.8f)
    assertTrue(thinking < idle)
    assertTrue(speaking > idle)
  }
}
