package dev.codewide.app.remote

import android.graphics.RenderNode
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import dev.codewide.app.rendering.VoiceAssistantOrbView
import java.time.Duration
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowLog
import org.robolectric.shadows.ShadowSettings
import org.robolectric.shadows.ShadowWindowManagerImpl

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GlobalVoiceOverlayAudioContractTest {
  @Test fun actualOverlaySelectsTheStyleInputAndReplaysItWithoutResizingItsWindow() {
    ShadowSettings.setCanDrawOverlays(true)
    ShadowChoreographer.setPaused(true)
    val context = RuntimeEnvironment.getApplication()
    val controller = GlobalVoiceOverlayController(context, {}, {}, false,
      VoiceAssistantOrbStyle.NEBULA, VoiceAssistantOrbState.LISTENING, true, null)
    controller.show()
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
    val manager: ShadowWindowManagerImpl = Shadow.extract(context.getSystemService(WindowManager::class.java))
    val root = manager.views.single()
    val width = root.layoutParams.width
    val height = root.layoutParams.height
    controller.updateAudioLevels(GlobalVoiceAudioLevels(0.03, 0.7, 0.48))
    for ((style, input) in listOf(
      VoiceAssistantOrbStyle.NEBULA to 0.03,
      VoiceAssistantOrbStyle.PARTICLES to 0.48,
      VoiceAssistantOrbStyle.NEBULA to 0.03,
    )) {
      controller.updateOrbStyle(style)
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
      val renderer = requireNotNull(findRenderer(root))
      assertTrue(renderer.width > 0)
      // Record the production hardware draw path; software Bitmap Canvas rejects AGSL.
      val node = RenderNode("orb-input-contract")
      node.setPosition(0, 0, renderer.width, renderer.height)
      renderer.draw(node.beginRecording())
      node.endRecording()
      // The content-free draw diagnostic is the public observation contract, not private fields.
      val drawn = ShadowLog.getLogsForTag("CodeWideVoiceRender").last().msg
      assertTrue(drawn, drawn.contains("state=listening"))
      assertTrue(drawn, drawn.contains("rawInput=$input "))
      assertTrue(drawn, drawn.contains("rawPlayback=0.7 "))
      assertEquals(width, root.layoutParams.width)
      assertEquals(height, root.layoutParams.height)
      assertSame(root, manager.views.single())
    }
    controller.hideImmediately()
    assertTrue(manager.views.isEmpty())
  }

  private fun findRenderer(view: View): VoiceAssistantOrbView? {
    if (view is VoiceAssistantOrbView) return view
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      findRenderer(view.getChildAt(index))?.let { return it }
    }
    return null
  }
}
