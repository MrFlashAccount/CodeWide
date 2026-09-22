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
import kotlin.math.hypot

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OrbBackdropRenderTest {
  @Test fun particlesBackdropContractsWithTheRenderedOrbWithoutResizingTheSlot() {
    val slot = slot(VoiceAssistantOrbStyle.PARTICLES)
    val idle = paintedRadius(slot)
    slot.setOrbState(VoiceAssistantOrbState.THINKING)
    val contracted = paintedRadius(slot)
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

  private fun paintedRadius(slot: VoiceAssistantOrbSlotView): Float {
    val bitmap = Bitmap.createBitmap(76, 76, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.translate(5f, 5f)
    slot.draw(canvas)
    assertEquals(0, Color.alpha(bitmap.getPixel(0, 0)))
    var radius = 0f
    for (x in 0 until 76) for (y in 0 until 76) {
      if (Color.alpha(bitmap.getPixel(x, y)) > 8) radius = maxOf(radius, hypot(x + 0.5f - 38, y + 0.5f - 38))
    }
    bitmap.recycle()
    return radius
  }
}
