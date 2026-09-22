package dev.codewide.app.remote

import android.animation.ValueAnimator
import android.content.Context
import android.view.MotionEvent
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import kotlin.math.abs

private enum class VoiceOverlayMenuState { COLLAPSED, EXPANDED }

/** Owns menu intent and its reversible timeline, independently of the orb renderer and session. */
internal class VoiceOverlayControls(
  context: Context,
  private var geometry: VoiceOverlayMenuGeometry,
  microphoneMuted: Boolean,
  onMicrophoneToggle: () -> Unit,
  onOpenApp: () -> Unit,
  onStop: () -> Unit,
  onSettings: () -> Unit,
  onOpenChat: () -> Unit,
  private var chatAvailable: Boolean,
  private val orbContains: (Float, Float) -> Boolean,
  onOrbTouch: (MotionEvent) -> Boolean,
  private val onExpansionChanged: (Boolean) -> Unit,
  private val onCollapsed: () -> Unit,
) {
  private val windowManager = context.getSystemService(WindowManager::class.java)
  private var state = VoiceOverlayMenuState.COLLAPSED
  private var progress = 0f
  private var reducedMotion = false
  private var disposed = false
  val isExpanded: Boolean get() = !disposed && state == VoiceOverlayMenuState.EXPANDED
  private var animation: ValueAnimator? = null
  private var orbCenter = geometry.orbCenter
  private val microphoneButton = VoiceOverlayIconButton(
    context, microphoneIcon(microphoneMuted), microphoneLabel(microphoneMuted),
  ) { if (interactive()) onMicrophoneToggle() }
  private val chatButton = VoiceOverlayIconButton(context, VoiceOverlayIcon.CHAT, "Open assistant chat") {
    if (interactive() && chatAvailable) onOpenChat()
  }
  private val buttons = listOf(
    microphoneButton,
    VoiceOverlayIconButton(context, VoiceOverlayIcon.STOP, "Stop Voice Assistant") {
      if (interactive()) onStop()
    },
    VoiceOverlayIconButton(context, VoiceOverlayIcon.OPEN_APP, "Open application") {
      if (interactive()) onOpenApp()
    },
    VoiceOverlayIconButton(context, VoiceOverlayIcon.SETTINGS, "Voice Assistant settings") {
      if (interactive()) onSettings()
    },
    chatButton,
  )
  private val windows = buttons.map { button ->
    VoiceOverlayActionWindow(
      context, windowManager, button, geometry.buttonSize,
      isOrbTouch = ::isOrbTouch,
      onOrbTouch = onOrbTouch,
      onOutsideTouch = ::outsideTouch,
      onGestureFinished = ::finishCollapse,
      onWindowDetached = ::windowDetached,
    )
  }

  fun show(reduced: Boolean) {
    try {
      applyProgress()
      windows.forEach { it.attach() }
      toggle(reduced)
    } catch (error: RuntimeException) {
      dispose()
      throw error
    }
  }

  fun setMicrophoneMuted(muted: Boolean) {
    microphoneButton.setIcon(microphoneIcon(muted), microphoneLabel(muted))
  }

  fun setChatAvailable(available: Boolean) {
    if (chatAvailable == available) return
    chatAvailable = available
    applyProgress()
  }

  fun setReducedMotion(reduced: Boolean) {
    reducedMotion = reduced
    if (reduced || !ValueAnimator.areAnimatorsEnabled()) {
      animation?.cancel()
      animation = null
      progress = if (state == VoiceOverlayMenuState.EXPANDED) 1f else 0f
      applyProgress()
      finishCollapse()
    }
  }

  fun toggle(reduced: Boolean) {
    changeState(
      if (state == VoiceOverlayMenuState.EXPANDED) VoiceOverlayMenuState.COLLAPSED else VoiceOverlayMenuState.EXPANDED,
      reduced, fast = false,
    )
  }

  fun collapse(reduced: Boolean, fast: Boolean = false) =
    changeState(VoiceOverlayMenuState.COLLAPSED, reduced, fast)

  fun updateGeometry(next: VoiceOverlayMenuGeometry) {
    geometry = next
    orbCenter = next.orbCenter
    applyProgress()
  }

  fun moveOrb(center: OverlayPoint) {
    orbCenter = center
    applyProgress()
  }

  fun dispose() {
    if (disposed) return
    disposed = true
    animation?.cancel()
    animation = null
    windows.forEach { it.dispose() }
  }

  private fun changeState(next: VoiceOverlayMenuState, reduced: Boolean, fast: Boolean) {
    if (disposed) return
    reducedMotion = reduced
    val changed = state != next
    if (!changed && !fast) {
      setReducedMotion(reduced)
      return
    }
    state = next
    if (changed) onExpansionChanged(next == VoiceOverlayMenuState.EXPANDED)
    animation?.cancel()
    animation = null
    val target = if (next == VoiceOverlayMenuState.EXPANDED) 1f else 0f
    if (reduced || !ValueAnimator.areAnimatorsEnabled()) {
      progress = target
      applyProgress()
      finishCollapse()
      return
    }
    val start = progress
    val fullDuration = when {
      fast -> VoiceOverlayMenuMotion.DRAG_CLOSE_DURATION_MS
      next == VoiceOverlayMenuState.EXPANDED -> VoiceOverlayMenuMotion.OPEN_DURATION_MS
      else -> VoiceOverlayMenuMotion.CLOSE_DURATION_MS
    }
    // Disable actions before the first closing frame, including accessibility activation.
    applyProgress()
    animation = ValueAnimator.ofFloat(0f, 1f).apply {
      interpolator = LinearInterpolator()
      duration = (fullDuration * abs(target - start)).toLong().coerceAtLeast(1L)
      addUpdateListener {
        progress = start + (target - start) * it.animatedFraction
        applyProgress()
        finishCollapse()
      }
    }
    animation?.start()
  }

  private fun applyProgress() {
    if (disposed) return
    windows.forEachIndexed { index, window ->
      val frame = VoiceOverlayMenuMotion.frame(progress, index)
      val target = geometry.centers[index]
      window.present(
        OverlayPoint(
          orbCenter.x + (target.x - orbCenter.x) * frame.travel,
          orbCenter.y + (target.y - orbCenter.y) * frame.travel,
        ),
        frame, interactive() && (buttons[index] !== chatButton || chatAvailable),
      )
    }
  }

  private fun interactive(): Boolean = !disposed && state == VoiceOverlayMenuState.EXPANDED && progress == 1f

  private fun isOrbTouch(x: Float, y: Float): Boolean =
    orbContains(x, y)

  private fun outsideTouch(x: Float, y: Float) {
    // ACTION_OUTSIDE also arrives at the other two action windows when one action is pressed.
    if (isOrbTouch(x, y) || windows.any { it.contains(x, y) }) return
    collapse(reducedMotion)
  }

  private fun finishCollapse() {
    if (disposed || state != VoiceOverlayMenuState.COLLAPSED || progress != 0f) return
    if (windows.any { it.forwardingOrbGesture }) return
    dispose()
    onCollapsed()
  }

  private fun windowDetached() {
    if (disposed) return
    dispose()
    onCollapsed()
  }

  private fun microphoneIcon(muted: Boolean): VoiceOverlayIcon = if (muted) VoiceOverlayIcon.MIC_OFF else VoiceOverlayIcon.MIC_ON
  private fun microphoneLabel(muted: Boolean): String = if (muted) "Mic on" else "Mic off"
}
