package dev.codewide.app.rendering

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OrbBackdropRenderTest {
  @Test fun particlesBackdropContractsWithTheRenderedOrbWithoutResizingTheSlot() {
    val slot = slot(VoiceAssistantOrbStyle.PARTICLES)
    val idle = particlesBackdropRadius(VoiceAssistantOrbState.IDLE)
    slot.setOrbState(VoiceAssistantOrbState.THINKING)
    val contracted = particlesBackdropRadius(VoiceAssistantOrbState.THINKING)
    assertTrue("thinking radius $contracted must contract from idle $idle", contracted < idle)
    assertEquals(66, slot.width)
    assertEquals(66, slot.height)
  }

  @Test fun nebulaBackdropUsesShaderDiscRadiusAndLeavesWindowCornersTransparent() {
    val slot = slot(VoiceAssistantOrbStyle.NEBULA)
    val radius = nebulaOrbVisualRadius(slot.width, slot.height)
    assertEquals(33f, radius, 0f)
    slot.setAudioLevels(1.0, 0.0)
    slot.setOrbState(VoiceAssistantOrbState.LISTENING)
    assertEquals(radius, nebulaOrbVisualRadius(slot.width, slot.height), 0f)
    // Bitmap Canvas cannot execute RuntimeShader. Exercise its production radius and backdrop;
    // AGSL output still requires a hardware Canvas/device check.
    val bitmap = Bitmap.createBitmap(76, 76, Bitmap.Config.ARGB_8888)
    OrbBackdrop().draw(Canvas(bitmap), 38f, 38f, radius, 3f, 0f, true)
    assertTrue(Color.alpha(bitmap.getPixel(72, 38)) > 0)
    assertEquals(0, Color.alpha(bitmap.getPixel(0, 0)))
    assertEquals(66, slot.width)
    bitmap.recycle()
  }

  private fun slot(style: VoiceAssistantOrbStyle) = VoiceAssistantOrbSlotView(RuntimeEnvironment.getApplication()).apply {
    setOrbStyle(style)
    setBackdropEnabled(true)
    setReducedMotion(true)
    measure(android.view.View.MeasureSpec.makeMeasureSpec(66, android.view.View.MeasureSpec.EXACTLY),
      android.view.View.MeasureSpec.makeMeasureSpec(66, android.view.View.MeasureSpec.EXACTLY))
    layout(0, 0, 66, 66)
  }

  private fun particlesBackdropRadius(state: VoiceAssistantOrbState): Float {
    val frame = ParticlesOrbSimulation(state).advance(
      state = state,
      inputLevel = null,
      playbackLevel = null,
      deltaSeconds = 0f,
      isStatic = true,
    )
    val visualRadius = ParticlesOrbGlFrameBuilder(1f).write(frame, 66f)
    return OrbBackdropRadius().update(visualRadius, 3f, 0f, true)
  }
}
