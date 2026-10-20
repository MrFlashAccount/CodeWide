package dev.codewide.app.rendering

import kotlin.math.hypot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ParticlesOrbGlFrameBuilderTest {
  @Test
  fun onlyActiveStatesRequestContinuousFrames() {
    for (state in VoiceAssistantOrbState.entries) {
      val input = renderInput(state)
      if (state == VoiceAssistantOrbState.IDLE || state == VoiceAssistantOrbState.DISABLED) {
        assertTrue(input.isStatic)
        assertFalse(input.requiresContinuousFrames)
      } else {
        assertFalse(input.isStatic)
        assertTrue(input.requiresContinuousFrames)
      }
    }

    val reducedMotion = renderInput(VoiceAssistantOrbState.SPEAKING, reducedMotion = true)
    assertTrue(reducedMotion.isStatic)
    assertFalse(reducedMotion.requiresContinuousFrames)
  }

  @Test
  fun everyStatePreservesCanvasGeometryAndQuantizedColorAtTheGlBoundary() {
    val points = ParticlesOrbModel.buildSphere()
    val builder = ParticlesOrbGlFrameBuilder(DENSITY)

    for (state in VoiceAssistantOrbState.entries) {
      val frame = ParticlesOrbSimulation(state).advance(
        state = state,
        inputLevel = 0.73f,
        playbackLevel = 0.41f,
        deltaSeconds = 1f / 60f,
      )
      val visualRadius = builder.write(frame, SIZE)
      var expectedVisualRadius = 0f

      for (index in points.indices) {
        val expected = ParticlesOrbModel.project(points[index], index, frame, SIZE, DENSITY)
        expectedVisualRadius = maxOf(
          expectedVisualRadius,
          hypot(expected.x - SIZE / 2f, expected.y - SIZE / 2f) + expected.dotRadius,
        )
        assertEquals(expected.x, builder.vertices.get(), 0f)
        assertEquals(expected.y, builder.vertices.get(), 0f)
        assertEquals(expected.dotRadius, builder.vertices.get(), 0f)
        assertEquals((expected.color shr 16 and 0xff) / 255f, builder.vertices.get(), 0f)
        assertEquals((expected.color shr 8 and 0xff) / 255f, builder.vertices.get(), 0f)
        assertEquals((expected.color and 0xff) / 255f, builder.vertices.get(), 0f)
        val expectedAlpha = (expected.alpha * 255f).toInt().coerceIn(0, 255) / 255f
        assertEquals(expectedAlpha, builder.vertices.get(), 0f)
      }
      assertEquals(expectedVisualRadius, visualRadius, 0f)
      assertEquals(0, builder.vertices.remaining())
    }
  }

  private companion object {
    const val DENSITY = 3f
    const val SIZE = 66f * DENSITY

    fun renderInput(
      state: VoiceAssistantOrbState,
      reducedMotion: Boolean = false,
    ): ParticlesOrbRenderInput = ParticlesOrbRenderInput(
      backdropEnabled = false,
      generation = 0L,
      inputLevel = null,
      orbState = state,
      playbackLevel = null,
      reducedMotion = reducedMotion,
    )
  }
}
