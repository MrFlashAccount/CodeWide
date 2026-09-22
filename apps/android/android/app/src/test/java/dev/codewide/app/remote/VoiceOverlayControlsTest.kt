package dev.codewide.app.remote

import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import java.time.Duration
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowWindowManagerImpl
import org.robolectric.shadow.api.Shadow

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VoiceOverlayControlsTest {
  private val context = RuntimeEnvironment.getApplication()
  private val density = context.resources.displayMetrics.density
  private val center = OverlayPoint(180f * density, 300f * density)
  private val geometry = requireNotNull(voiceOverlayMenuGeometry(
    center, OverlaySafeBounds(8f * density, 32f * density, 352f * density, 768f * density), density,
  ))
  private val actions = mutableListOf<String>()
  private var collapsed = 0
  private val expansion = mutableListOf<Boolean>()

  @Before fun pauseFrames() {
    ShadowChoreographer.setPaused(true)
    ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
  }

  @Test fun micRemainsOpenAndWaitsForConfirmedStateWhileActionsHaveDistinctCallbacks() {
    val menu = menu()
    menu.show(true)
    advance(2)
    assertEquals(setOf("Mic off", "Open application", "Stop Voice Assistant", "Voice Assistant settings", "Open assistant chat"), buttons().map { it.contentDescription }.toSet())
    button("Mic off").performClick()
    assertEquals(listOf("mic"), actions)
    assertEquals(0, collapsed)
    assertNotNull(button("Mic off"))
    menu.setMicrophoneMuted(true)
    assertNotNull(button("Mic on"))
    button("Open application").performClick()
    button("Stop Voice Assistant").performClick()
    button("Voice Assistant settings").performClick()
    button("Open assistant chat").performClick()
    assertEquals(listOf("mic", "open", "stop", "settings", "chat"), actions)
    menu.toggle(true)
    assertEquals(1, collapsed)
    assertEquals(listOf(true, false), expansion)
    assertTrue(roots().isEmpty())
  }

  @Test fun noSpanningWindowConsumesTheOrbOrTheGapsBetweenActions() {
    val menu = menu()
    menu.show(true)
    advance(2)
    val params = roots().map(::params)
    assertEquals(5, params.size)
    for (window in params) {
      assertTrue(window.width >= 48 * density)
      assertTrue(window.width <= 56 * density)
      assertEquals(window.width, window.height)
      assertTrue(window.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL != 0)
      assertFalse(contains(window, center))
    }
    val gap = OverlayPoint(
      (geometry.centers[0].x + geometry.centers[1].x) / 2,
      (geometry.centers[0].y + geometry.centers[1].y) / 2,
    )
    assertTrue(params.none { contains(it, gap) })
    // Android delivers OUTSIDE to sibling windows too. An action press must not dismiss its menu.
    val sibling = roots().last()
    send(sibling, MotionEvent.ACTION_OUTSIDE, geometry.centers.first())
    assertEquals(0, collapsed)
    send(sibling, MotionEvent.ACTION_OUTSIDE, gap)
    assertEquals(1, collapsed)
    assertTrue(roots().isEmpty())
  }

  @Test fun reversalRetainsPositionsAndPreventsActionsBeforeRevealCompletes() {
    val menu = menu()
    menu.show(false)
    advance(5)
    val views = buttons()
    assertTrue(views.first().alpha > views.last().alpha)
    assertTrue(views.all { !it.isEnabled })
    views.forEach { it.performClick() }
    assertTrue(actions.isEmpty())
    val before = roots().map { Pair(params(it).x, params(it).y) }
    menu.toggle(false)
    assertFalse("Inset reflow must not reopen a retracting menu", menu.isExpanded)
    assertEquals(before, roots().map { Pair(params(it).x, params(it).y) })
    advance(2)
    menu.toggle(false)
    assertTrue(menu.isExpanded)
    advance(24)
    assertEquals(0, collapsed)
    assertTrue(buttons().all { it.isEnabled })
    button("Mic off").performClick()
    assertEquals(listOf("mic"), actions)
    menu.dispose()
    assertTrue(roots().isEmpty())
  }

  @Test fun reducedMotionCanChangeMidAnimationAndAppliesToOutsideDismissal() {
    val menu = menu()
    menu.show(false)
    advance(4)
    menu.setReducedMotion(true)
    assertTrue(buttons().all { it.isEnabled && it.alpha == 1f })
    send(roots().first(), MotionEvent.ACTION_OUTSIDE, OverlayPoint(0f, 0f))
    assertEquals(1, collapsed)
    advance(30)
    assertTrue(roots().isEmpty())
    assertEquals(1, collapsed)
  }

  @Test fun emergingButtonForwardsAnOrbDragUntilUpEvenWhenReducedMotionCollapsesImmediately() {
    val events = mutableListOf<Int>()
    lateinit var menu: VoiceOverlayControls
    menu = menu { event ->
      events.add(event.actionMasked)
      if (event.actionMasked == MotionEvent.ACTION_MOVE) menu.collapse(true, fast = true)
      true
    }
    menu.show(false)
    val surface = roots().last()
    send(surface, MotionEvent.ACTION_DOWN, center)
    send(surface, MotionEvent.ACTION_MOVE, OverlayPoint(center.x + 40, center.y + 20))
    assertEquals(0, collapsed)
    assertTrue(buttons().all { !it.isEnabled })
    send(surface, MotionEvent.ACTION_UP, OverlayPoint(center.x + 40, center.y + 20))
    assertEquals(1, collapsed)
    assertTrue(roots().isEmpty())
    assertEquals(listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP), events)
    assertTrue(actions.isEmpty())
  }

  @Test fun disposalDuringAnimationCancelsCallbacksAndRemovesEveryWindow() {
    val menu = menu()
    menu.show(false)
    advance(3)
    menu.dispose()
    advance(30)
    assertTrue(roots().isEmpty())
    assertEquals(0, collapsed)
    assertTrue(actions.isEmpty())
  }

  @Test fun aPressStartedDuringRevealCannotBecomeStopWhenRevealFinishes() {
    val menu = menu()
    menu.show(false)
    advance(6)
    val surface = roots().single { root ->
      require(root is ViewGroup)
      root.getChildAt(0).contentDescription == "Stop Voice Assistant"
    }
    send(surface, MotionEvent.ACTION_DOWN, windowCenter(surface))
    advance(24)
    assertTrue(button("Stop Voice Assistant").isEnabled)
    send(surface, MotionEvent.ACTION_UP, windowCenter(surface))
    advance(2)
    assertTrue(actions.isEmpty())
    send(surface, MotionEvent.ACTION_DOWN, windowCenter(surface))
    send(surface, MotionEvent.ACTION_UP, windowCenter(surface))
    advance(2)
    assertEquals(listOf("stop"), actions)
    menu.dispose()
  }

  @Test fun systemWindowRemovalCancelsAnimationAndClosesSiblingWindows() {
    val menu = menu()
    menu.show(false)
    advance(3)
    context.getSystemService(WindowManager::class.java).removeViewImmediate(roots().first())
    advance(30)
    assertTrue(roots().isEmpty())
    assertEquals(1, collapsed)
  }

  @Test fun realSettledCoordinatesDeliverEachActionExactlyOnceWithSiblingOutsideEvents() {
    for ((label, action) in listOf("Mic off" to "mic", "Stop Voice Assistant" to "stop",
      "Open application" to "open", "Voice Assistant settings" to "settings")) {
      actions.clear()
      val menu = menu()
      menu.show(false)
      advance(30)
      val target = roots().single { (it as ViewGroup).getChildAt(0).contentDescription == label }
      val location = IntArray(2)
      target.getLocationOnScreen(location)
      val point = OverlayPoint(location[0] + target.width / 2f, location[1] + target.height / 2f)
      roots().filter { it !== target }.forEach { send(it, MotionEvent.ACTION_OUTSIDE, point) }
      send(target, MotionEvent.ACTION_DOWN, point)
      send(target, MotionEvent.ACTION_UP, point)
      advance(2)
      assertEquals("Tap $label at $point", listOf(action), actions)
      menu.dispose()
    }
  }

  @Test fun secondOrbGestureClosesAndANewGestureReopensWithoutReplayingOpen() {
    val menu = menu()
    menu.show(false)
    advance(30)
    val initialWindows = roots().toList()
    initialWindows.forEach { send(it, MotionEvent.ACTION_OUTSIDE, center) }
    menu.toggle(false)
    assertFalse(menu.isExpanded)
    assertEquals(initialWindows, roots())
    advance(16)
    assertTrue(roots().isEmpty())
    assertEquals(listOf(true, false), expansion)
    val reopened = menu()
    reopened.show(false)
    advance(30)
    assertTrue(reopened.isExpanded)
    assertEquals(5, roots().size)
    assertTrue(buttons().all { it.isEnabled })
    reopened.dispose()
  }

  private fun menu(onOrbTouch: (MotionEvent) -> Boolean = { true }) = VoiceOverlayControls(
    context, geometry, false,
    { actions.add("mic") }, { actions.add("open") }, { actions.add("stop") },
    { actions.add("settings") }, { actions.add("chat") }, true,
    { x, y -> kotlin.math.abs(x - center.x) <= 38f * density && kotlin.math.abs(y - center.y) <= 38f * density },
    onOrbTouch, { expansion.add(it) }, { collapsed += 1 },
  )

  private fun roots(): List<View> {
    val shadow: ShadowWindowManagerImpl = Shadow.extract(context.getSystemService(WindowManager::class.java))
    return shadow.views
  }

  private fun buttons(): List<View> = roots().map { root ->
    require(root is ViewGroup)
    root.getChildAt(0)
  }

  private fun button(label: String): View = buttons().single { it.contentDescription == label }

  private fun params(view: View): WindowManager.LayoutParams {
    val params = view.layoutParams
    require(params is WindowManager.LayoutParams)
    return params
  }

  private fun contains(params: WindowManager.LayoutParams, point: OverlayPoint): Boolean =
    point.x >= params.x && point.x <= params.x + params.width && point.y >= params.y && point.y <= params.y + params.height

  private fun send(view: View, action: Int, point: OverlayPoint) {
    val event = MotionEvent.obtain(0, 1, action, point.x, point.y, 0)
    val position = params(view)
    event.offsetLocation(-position.x.toFloat(), -position.y.toFloat())
    view.dispatchTouchEvent(event)
    event.recycle()
  }

  private fun windowCenter(view: View): OverlayPoint {
    val params = params(view)
    return OverlayPoint(params.x + params.width / 2f, params.y + params.height / 2f)
  }

  private fun advance(frames: Int) {
    repeat(frames) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
  }
}
