package dev.codewide.app.remote

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import dev.codewide.app.rendering.ParticlesOrbView
import dev.codewide.app.rendering.OrbBackdrop
import dev.codewide.app.rendering.VoiceOverlayContrast
import dev.codewide.app.rendering.VoiceAssistantOrbState
import org.robolectric.RuntimeEnvironment
import java.io.File
import kotlin.math.pow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class VoiceOverlayContrastTest {
  @Test fun featheredBackplateBoundsBusyBackgroundWithoutMakingParticlesOpaque() {
    for (background in listOf(Color.WHITE, Color.BLACK, Color.RED, Color.GREEN, Color.BLUE)) {
      val bitmap = Bitmap.createBitmap(76, 76, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(background)
      val canvas = Canvas(bitmap)
      OrbBackdrop().draw(canvas, 38f, 38f, 20f, 3f, 0f, true)
      val core = bitmap.getPixel(38, 38)
      // A bright foreground dot (upstream alpha at depth .8) remains distinguishable even on white.
      val alpha = 0.12 + 0.8 * 0.8 * 0.78
      val dot = listOf(190, 155, 250).zip(listOf(Color.red(core), Color.green(core), Color.blue(core))) { fg, bg -> fg * alpha + bg * (1 - alpha) }
      val contrast = (luminance(dot) + 0.05) / (luminance(listOf(Color.red(core).toDouble(), Color.green(core).toDouble(), Color.blue(core).toDouble())) + 0.05)
      assertTrue("foreground contrast $contrast over $background", contrast >= 3.0)
      assertEquals(background, bitmap.getPixel(0, 0))
      bitmap.recycle()
    }
    assertTrue(VoiceOverlayContrast.alphaAt(0f) < 0.9f)
    assertEquals(VoiceOverlayContrast.alphaAt(0f), VoiceOverlayContrast.alphaAt(0.75f), 0f)
    assertTrue(VoiceOverlayContrast.alphaAt(0.9f) < VoiceOverlayContrast.alphaAt(0.75f))
    assertEquals(0f, VoiceOverlayContrast.alphaAt(1f), 0f)
  }

  @Test fun rendersBeforeAndAfterOnWhiteDarkAndBusyBackgrounds() {
    val sheet = Bitmap.createBitmap(720, 520, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(sheet)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val context = RuntimeEnvironment.getApplication()
    val density = context.resources.displayMetrics.density
    val view = ParticlesOrbView(context).apply {
      setOrbState(VoiceAssistantOrbState.LISTENING)
      setReducedMotion(true)
      layout(0, 0, (66 * density).toInt(), (66 * density).toInt())
    }
    for (row in 0..1) for (column in 0..2) {
      val saved = canvas.save()
      canvas.translate(column * 240f, row * 260f)
      paint.color = if (column == 0) Color.WHITE else Color.rgb(20, 23, 30)
      canvas.drawRect(0f, 0f, 240f, 260f, paint)
      if (column == 2) {
        for (x in 0..7) for (y in 0..7) {
          paint.color = listOf(Color.WHITE, Color.rgb(234, 109, 90), Color.rgb(54, 143, 152), Color.rgb(34, 40, 68))[(x + y) % 4]
          canvas.drawRect(x * 32f, y * 32f, x * 32f + 32, y * 32f + 32, paint)
        }
      }
      canvas.translate(6f, 20f)
      canvas.scale(3f / density, 3f / density)
      view.setBackdropEnabled(row == 1)
      canvas.translate(5f * density, 5f * density)
      view.draw(canvas)
      canvas.restoreToCount(saved)
    }
    // Keep the review artifact with the build reports instead of ephemeral temporary files.
    val output = File("build/reports/voice-overlay/codewide-orb-contrast.png").absoluteFile
    val directory = requireNotNull(output.parentFile)
    check(directory.mkdirs() || directory.isDirectory)
    output.outputStream().use { sheet.compress(Bitmap.CompressFormat.PNG, 100, it) }
    assertTrue(output.length() > 0)
    sheet.recycle()
  }

  private fun luminance(channels: List<Double>): Double {
    val linear = channels.map { channel ->
      val value = channel / 255.0
      if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
    }
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
}
