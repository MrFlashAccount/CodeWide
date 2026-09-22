package dev.codewide.app.remote

import android.graphics.Insets
import android.view.WindowInsets
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VoiceOverlaySafeBoundsTest {
  @Test fun keyboardChangesPreserveFullOrbAndFanTargetsAboveItsTop() {
    val system = WindowInsets.Builder()
      .setInsetsIgnoringVisibility(WindowInsets.Type.systemBars(), Insets.of(0, 24, 0, 24))
      .setInsetsIgnoringVisibility(WindowInsets.Type.systemGestures(), Insets.of(16, 0, 16, 32))
      .build()
    val keyboard = WindowInsets.Builder(system)
      .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 320))
      .setVisible(WindowInsets.Type.ime(), true)
      .build()
    val bounds = voiceOverlaySafeBounds(400, 800, keyboard, 76, 76, 8f)
    val area = voiceOverlaySafeBounds(400, 800, keyboard, 0, 0, 8f)
    assertTrue(bounds.minX >= 16)
    assertTrue(bounds.maxX + 76 <= 400 - 16)
    assertTrue(bounds.maxY + 76 <= 800 - 320)
    val orb = GlobalVoiceOverlayPlacement.restore(OverlayPoint(1f, 1f), bounds)
    val menu = requireNotNull(voiceOverlayMenuGeometry(OverlayPoint(orb.x + 38, orb.y + 38), area, 1f))
    assertTrue(menu.centers.all { it.y + menu.buttonSize / 2 <= 800 - 320 })
    val withoutKeyboard = voiceOverlaySafeBounds(400, 800, system, 76, 76, 8f)
    assertTrue(withoutKeyboard.maxY > bounds.maxY)
    assertEquals(withoutKeyboard.minX, bounds.minX, 0f)
  }

  @Test fun displayCutoutAndLandscapeSideKeyboardAreReserved() {
    val insets = WindowInsets.Builder()
      .setInsetsIgnoringVisibility(WindowInsets.Type.displayCutout(), Insets.of(40, 0, 0, 0))
      .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 280, 0))
      .setVisible(WindowInsets.Type.ime(), true)
      .build()
    val bounds = voiceOverlaySafeBounds(800, 360, insets, 76, 76, 8f)
    assertTrue(bounds.minX >= 40)
    assertTrue(bounds.maxX + 76 <= 520)
    assertTrue(bounds.maxY + 76 <= 360)
  }
}
