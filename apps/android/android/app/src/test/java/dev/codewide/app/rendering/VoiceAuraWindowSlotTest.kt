package dev.codewide.app.rendering

import android.app.Activity
import android.graphics.PixelFormat
import android.os.Looper
import android.view.View
import android.view.WindowManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowWindowManagerImpl
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VoiceAuraWindowSlotTest {
  private lateinit var activity: Activity
  private lateinit var baseline: Set<View>

  @Before fun setup() {
    activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    advance()
    ShadowChoreographer.setPaused(true)
    ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
    baseline = roots().toSet()
  }

  @Test fun repeatedEnsureBeforeFirstTraversalKeepsOneWindowAndRemovesIt() {
    val slot = slot()
    val first = slot.ensure(activity)
    assertNotNull(first)
    assertFalse("the race exists only before the first traversal", first!!.isAttachedToWindow)

    assertSame(first, slot.ensure(activity))
    assertEquals(1, auraWindows().size)

    slot.remove()
    advance()
    assertTrue(auraWindows().isEmpty())
  }

  @Test fun removeBeforeFirstTraversalLeavesNoWindow() {
    val slot = slot()
    slot.ensure(activity)
    slot.remove()
    advance()
    assertTrue(auraWindows().isEmpty())
  }

  @Test fun windowThatAttachesWithoutOwnershipRemovesItself() {
    val slot = slot()
    val orphan = SelfRemovingView(activity, slot)
    activity.windowManager.addView(orphan, params(activity.window.decorView.windowToken))
    advance()
    assertTrue(auraWindows().isEmpty())
  }

  private fun slot(): VoiceAuraWindowSlot<SelfRemovingView> =
    VoiceAuraWindowSlot(::SelfRemovingView, this::params)

  private fun params(token: android.os.IBinder) = WindowManager.LayoutParams(
    WindowManager.LayoutParams.MATCH_PARENT,
    WindowManager.LayoutParams.MATCH_PARENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_ATTACHED_DIALOG,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
    PixelFormat.TRANSLUCENT,
  ).apply { this.token = token }

  private fun auraWindows(): List<View> = roots().filterNot(baseline::contains)

  private fun roots(): List<View> {
    val manager: ShadowWindowManagerImpl = Shadow.extract(activity.windowManager)
    return manager.views
  }

  private fun advance() {
    repeat(3) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
  }

  private class SelfRemovingView(
    private val activity: Activity,
    private val owner: VoiceAuraWindowSlot<SelfRemovingView>,
  ) : View(activity) {
    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      owner.onViewAttached(this, activity.windowManager)
    }
  }
}
