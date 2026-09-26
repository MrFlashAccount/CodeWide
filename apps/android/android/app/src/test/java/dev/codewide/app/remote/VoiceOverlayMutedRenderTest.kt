package dev.codewide.app.remote

import android.content.ContextWrapper
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import dev.codewide.app.rendering.VoiceAssistantOrbSlotView
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class VoiceOverlayMutedRenderTest {
  @Test fun canonicalMicGlyphAndItsAccessibilityStateChangeTogether() {
    val application = RuntimeEnvironment.getApplication()
    // JVM tests have no installed APK. Mount the production-generated assets, not a test font.
    val archive = File("build/reports/voice-overlay/icon-assets.apk").absoluteFile
    archive.parentFile.mkdirs()
    ZipOutputStream(archive.outputStream()).use { zip ->
      for (name in listOf("ionicons.ttf", "Ionicons.json")) {
        zip.putNextEntry(ZipEntry("assets/fonts/$name"))
        File("build/generated/iconFontAssets/fonts/$name").inputStream().use { it.copyTo(zip) }
        zip.closeEntry()
      }
    }
    val assets = AssetManager::class.java.getDeclaredConstructor().newInstance()
    AssetManager::class.java.getMethod("addAssetPath", String::class.java)
      .invoke(assets, archive.path)
    val context = object : ContextWrapper(application) { override fun getAssets() = assets }
    val button = VoiceOverlayIconButton(context, VoiceOverlayIcon.MIC_ON, "Mic off") {}
    button.layout(0, 0, 48, 48)
    val on = render(button)
    assertEquals("Microphone on", button.stateDescription)
    button.setIcon(VoiceOverlayIcon.MIC_OFF, "Mic on")
    val off = render(button)
    assertEquals("Microphone off", button.stateDescription)
    assertFalse(on.sameAs(off))
    assertEquals("mic-outline", VoiceOverlayIcon.MIC_ON.glyphName)
    assertEquals("mic-off-outline", VoiceOverlayIcon.MIC_OFF.glyphName)
    for (icon in listOf(VoiceOverlayIcon.SETTINGS, VoiceOverlayIcon.OPEN_APP, VoiceOverlayIcon.STOP, VoiceOverlayIcon.CHAT)) {
      button.setIcon(icon, icon.glyphName)
      assertFalse(render(button).sameAs(on))
    }
  }

  @Test fun muteKeepsTheRendererAndOwnsItsHardwareColorFilterLayer() {
    val context = RuntimeEnvironment.getApplication()
    val orb = VoiceAssistantOrbSlotView(context).apply {
      setOrbStyle(VoiceAssistantOrbStyle.PARTICLES)
      setOrbState(VoiceAssistantOrbState.LISTENING)
      setReducedMotion(true)
    }
    val parent = FrameLayout(context).apply { addView(orb, FrameLayout.LayoutParams(76, 76)) }
    parent.measure(View.MeasureSpec.makeMeasureSpec(76, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(76, View.MeasureSpec.EXACTLY))
    parent.layout(0, 0, 76, 76)
    val renderer = orb.getChildAt(0)
    assertEquals(View.LAYER_TYPE_NONE, orb.layerType)
    orb.setMicrophoneMuted(true)
    assertSame(renderer, orb.getChildAt(0))
    assertEquals(View.LAYER_TYPE_HARDWARE, orb.layerType)
    orb.setMicrophoneMuted(false)
    assertSame(renderer, orb.getChildAt(0))
    assertEquals(View.LAYER_TYPE_NONE, orb.layerType)
    // TextureView pixels are composed by the device GPU and cannot be captured by Robolectric's
    // Bitmap Canvas. Device validation owns the grayscale output; this test owns its stable layer.
  }

  private fun render(view: View): Bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also {
    view.draw(Canvas(it))
  }

}
