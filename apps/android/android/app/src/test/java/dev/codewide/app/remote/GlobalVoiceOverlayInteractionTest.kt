package dev.codewide.app.remote

import android.os.Looper
import android.graphics.Insets
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.WindowInsets
import android.view.WindowMetrics
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowSettings
import org.robolectric.shadows.ShadowWindowManagerImpl
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class GlobalVoiceOverlayInteractionTest {
  private val context = RuntimeEnvironment.getApplication()
  private val actions = mutableListOf<String>()
  private var time = 1L

  @Before fun setup() {
    ShadowSettings.setCanDrawOverlays(true)
    ShadowChoreographer.setPaused(true)
    ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
  }

  @Test fun appliedWindowFramesProtectOrbToggleAndAllFiveActionGestures() {
    for (label in listOf("Mic off", "Stop Voice Assistant", "Open application", "Voice Assistant settings", "Open assistant chat")) {
      actions.clear()
      val controller = controller()
      controller.show()
      advance(3)
      val orb = roots().single()
      tap(orb)
      advance(30)
      assertEquals(6, roots().size)
      // Model WM's applied frame differing from requested LayoutParams. Outside dispatch
      // uses screen coordinates; comparing it with requested px loses both Mic and Stop.
      roots().forEach { it.translationY = 160f }
      val target = roots().single { it is ViewGroup && it.getChildAt(0).contentDescription == label }
      tap(target)
      if (label == "Stop Voice Assistant") tap(target)
      advance(3)
      when (label) {
        "Mic off" -> assertEquals(listOf("mic"), actions)
        "Stop Voice Assistant" -> assertEquals(listOf("stop"), actions)
        "Open assistant chat" -> {
          val intent = shadowOf(context).nextStartedActivity
          assertEquals(listOf("threads", "voice-server", "voice-thread"), intent.data?.pathSegments)
          assertNull(shadowOf(context).nextStartedActivity)
          assertTrue(actions.isEmpty())
        }
        "Voice Assistant settings" -> {
          val intent = shadowOf(context).nextStartedActivity
          assertEquals("/settings", intent.data?.path)
          assertEquals("voice-assistant", intent.data?.getQueryParameter("section"))
          assertNull(shadowOf(context).nextStartedActivity)
          assertTrue(actions.isEmpty())
        }
        else -> {
          assertEquals("dev.codewide.app.MainActivity", shadowOf(context).nextStartedActivity.component?.className)
          assertNull(shadowOf(context).nextStartedActivity)
          assertTrue(actions.isEmpty())
        }
      }
      controller.hideImmediately()
    }
  }

  @Test fun chatUsesCurrentQualifiedHomeAndNeverStopsOrMutesTheActivation() {
    val controller = controller()
    controller.show()
    advance(3)
    tap(roots().single())
    advance(30)
    val chat = roots().single { it is ViewGroup && it.getChildAt(0).contentDescription == "Open assistant chat" }
    controller.updateChatTarget(null)
    tap(chat)
    advance(2)
    assertNull(shadowOf(context).nextStartedActivity)
    controller.updateChatTarget(VoiceOverlayChatTarget("server/with space", "thread?#%/next"))
    tap(chat)
    advance(2)
    val intent = shadowOf(context).nextStartedActivity
    assertEquals(listOf("threads", "server/with space", "thread?#%/next"), intent.data?.pathSegments)
    assertNull(intent.data?.query)
    assertNull(intent.data?.fragment)
    assertEquals(context.packageName, intent.`package`)
    assertNull(shadowOf(context).nextStartedActivity)
    advance(16)
    assertEquals(1, roots().size)
    assertTrue(actions.isEmpty())
    controller.hideImmediately()
  }

  @Test fun secondRealOrbTapClosesExistingWindowsAndThirdTapReopens() {
    val controller = controller()
    controller.show()
    advance(3)
    val orb = roots().single()
    tap(orb)
    advance(30)
    val expanded = roots().toList()
    roots().forEach { it.translationY = 160f }
    tap(orb)
    assertEquals("Actions collapsed", orb.stateDescription)
    assertEquals(expanded, roots())
    advance(16)
    assertEquals(listOf(orb), roots())
    tap(orb)
    advance(30)
    assertEquals("Actions expanded", orb.stateDescription)
    assertEquals(6, roots().size)
    assertTrue(actions.isEmpty())
    controller.hideImmediately()
  }

  @Test fun dragAndCancellationNeverDispatchStop() {
    val controller = controller()
    controller.show()
    advance(3)
    tap(roots().single())
    advance(30)
    val stop = roots().single { it is ViewGroup && it.getChildAt(0).contentDescription == "Stop Voice Assistant" }
    val point = center(stop)
    send(stop, MotionEvent.ACTION_DOWN, point)
    send(stop, MotionEvent.ACTION_MOVE, OverlayPoint(point.x + stop.width * 2, point.y))
    send(stop, MotionEvent.ACTION_UP, OverlayPoint(point.x + stop.width * 2, point.y))
    advance(3)
    assertTrue(actions.isEmpty())
    send(stop, MotionEvent.ACTION_DOWN, point)
    send(stop, MotionEvent.ACTION_CANCEL, point)
    advance(3)
    assertTrue(actions.isEmpty())
    controller.hideImmediately()
  }

  @Test fun rotationIgnoresWindowLocalInsetsAndKeepsOneStableRemapAndMenu() {
    for (navigation in listOf(24, 48)) {
      fun displayMetrics(width: Int, height: Int, side: Boolean) = WindowMetrics(Rect(0, 0, width, height), WindowInsets.Builder()
        .setInsetsIgnoringVisibility(WindowInsets.Type.systemBars(), if (side) Insets.of(0, 24, navigation, 0) else Insets.of(0, 24, 0, navigation))
        .setInsetsIgnoringVisibility(WindowInsets.Type.systemGestures(), Insets.of(8, 0, 8, 16)).build())
      var metrics = displayMetrics(400, 800, false)
      val preferences = context.getSharedPreferences("global_voice_overlay", 0)
      preferences.edit().putFloat("x_fraction", 1f).putFloat("y_fraction", 0.82f).putString("mode", "free").commit()
      val controller = GlobalVoiceOverlayController(context, {}, {}, false,
        VoiceAssistantOrbStyle.NEBULA, VoiceAssistantOrbState.LISTENING, false, null, { metrics })
      controller.show()
      advance(3)
      val orb = roots().single()
      tap(orb)
      advance(30)
      val windows = roots().toList()
      metrics = displayMetrics(800, 400, true)
      controller.onConfigurationChanged()
      val oldLocal = WindowInsets.Builder().setInsetsIgnoringVisibility(WindowInsets.Type.systemBars(), Insets.of(0, 24, 0, 48)).build()
      orb.dispatchApplyWindowInsets(oldLocal)
      orb.dispatchApplyWindowInsets(WindowInsets.CONSUMED)
      advance(4)
      val params = orb.layoutParams
      require(params is WindowManager.LayoutParams)
      val target = OverlayPoint(params.x.toFloat(), params.y.toFloat())
      val expectedBounds = voiceOverlaySafeBounds(800, 400, metrics.windowInsets, params.width, params.height, 8f)
      val expected = GlobalVoiceOverlayPlacement.restore(OverlayPoint(1f, 0.82f), expectedBounds)
      val expectedMenu = requireNotNull(voiceOverlayMenuGeometry(
        OverlayPoint(expected.x + params.width / 2f, expected.y + params.height / 2f),
        voiceOverlaySafeBounds(800, 400, metrics.windowInsets, 0, 0, 8f), 1f,
      ))
      assertEquals((expectedMenu.orbCenter.x - params.width / 2f).toInt(), params.x)
      assertEquals((expectedMenu.orbCenter.y - params.height / 2f).toInt(), params.y)
      assertEquals(windows, roots())
      repeat(12) {
        orb.dispatchApplyWindowInsets(if (it % 2 == 0) oldLocal else WindowInsets.CONSUMED)
        advance(3)
        assertEquals(target, OverlayPoint(params.x.toFloat(), params.y.toFloat()))
        assertEquals(windows, roots())
      }
      assertEquals(0.82f, preferences.getFloat("y_fraction", 0f), 0f)
      assertEquals("Actions expanded", orb.stateDescription)
      tap(orb)
      advance(16)
      assertEquals(expected.x.toInt(), params.x)
      assertEquals(expected.y.toInt(), params.y)
      controller.hideImmediately()
    }
  }

  @Test fun cornersKeepOneArcAndRestoreUserPositionAfterSecondTap() {
    for (x in listOf(0f, 1f)) for (y in listOf(0f, 1f)) {
      val preferences = context.getSharedPreferences("global_voice_overlay", 0)
      preferences.edit().putFloat("x_fraction", x).putFloat("y_fraction", y).putString("mode", "free").commit()
      val controller = controller()
      controller.show()
      advance(3)
      val orb = roots().single()
      val original = center(orb)
      tap(orb)
      advance(30)
      val openedCenter = center(orb)
      assertNotEquals("The complete fan needs room at a corner", original, openedCenter)
      for (action in roots().filter { it !== orb }) {
        val position = center(action)
        assertEquals(88f * context.resources.displayMetrics.density,
          kotlin.math.hypot(position.x - openedCenter.x, position.y - openedCenter.y), 1.5f)
      }
      val mic = roots().single { it is ViewGroup && it.getChildAt(0).contentDescription == "Mic off" }
      actions.clear()
      tap(mic)
      advance(2)
      assertEquals(listOf("mic"), actions)
      assertEquals(x, preferences.getFloat("x_fraction", -1f), 0f)
      assertEquals(y, preferences.getFloat("y_fraction", -1f), 0f)
      tap(orb)
      advance(16)
      assertEquals(listOf(orb), roots())
      assertEquals(original, center(orb))
      tap(orb)
      advance(30)
      assertEquals(openedCenter, center(orb))
      val stop = roots().single { it is ViewGroup && it.getChildAt(0).contentDescription == "Stop Voice Assistant" }
      tap(stop)
      advance(16)
      assertEquals(listOf("mic", "stop"), actions)
      assertEquals(original, center(orb))
      controller.hideImmediately()
    }
  }

  @Test fun draggingTheTemporarilyShiftedOrbReplacesItsReturnPosition() {
    val preferences = context.getSharedPreferences("global_voice_overlay", 0)
    preferences.edit().putFloat("x_fraction", 0f).putFloat("y_fraction", 0f).putString("mode", "free").commit()
    val controller = controller()
    controller.show()
    advance(3)
    val orb = roots().single()
    tap(orb)
    advance(30)
    val start = center(orb)
    val destination = OverlayPoint(start.x + 80f, start.y + 140f)
    send(orb, MotionEvent.ACTION_DOWN, start)
    send(orb, MotionEvent.ACTION_MOVE, destination)
    advance(16)
    assertEquals(listOf(orb), roots())
    assertEquals(destination, center(orb))
    send(orb, MotionEvent.ACTION_UP, destination)
    advance(40)
    assertEquals(destination, center(orb))
    assertTrue(preferences.getFloat("x_fraction", 0f) > 0f)
    assertTrue(preferences.getFloat("y_fraction", 0f) > 0f)
    assertTrue(actions.isEmpty())
    controller.hideImmediately()
  }

  private fun controller() = GlobalVoiceOverlayController(
    context, { actions.add("mic") }, { actions.add("stop") }, false,
    VoiceAssistantOrbStyle.NEBULA, VoiceAssistantOrbState.LISTENING, false, null,
  ).also { it.updateChatTarget(VoiceOverlayChatTarget("voice-server", "voice-thread")) }

  private fun roots(): List<View> {
    val manager: ShadowWindowManagerImpl = Shadow.extract(context.getSystemService(WindowManager::class.java))
    return manager.views
  }

  private fun center(view: View): OverlayPoint {
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    return OverlayPoint(location[0] + view.width / 2f, location[1] + view.height / 2f)
  }

  private fun tap(target: View) {
    time += 1000
    val point = center(target)
    // Choose the topmost applied window at the final animated screen point before dispatch.
    // Sending directly to the named button would hide an overlapping input window.
    val recipient = roots().asReversed().firstOrNull { view ->
      val location = IntArray(2)
      view.getLocationOnScreen(location)
      point.x >= location[0] && point.x < location[0] + view.width &&
        point.y >= location[1] && point.y < location[1] + view.height
    }
    assertSame("The visible target must own its final screen coordinate $point", target, recipient)
    requireNotNull(recipient)
    roots().filter { it !== recipient }.forEach { send(it, MotionEvent.ACTION_OUTSIDE, point) }
    send(recipient, MotionEvent.ACTION_DOWN, point)
    send(recipient, MotionEvent.ACTION_UP, point)
  }

  private fun send(view: View, action: Int, point: OverlayPoint) {
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val event = MotionEvent.obtain(time, time + 1, action, point.x, point.y, 0)
    event.offsetLocation(-location[0].toFloat(), -location[1].toFloat())
    view.dispatchTouchEvent(event)
    event.recycle()
  }

  private fun advance(frames: Int) {
    repeat(frames) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
  }
}
