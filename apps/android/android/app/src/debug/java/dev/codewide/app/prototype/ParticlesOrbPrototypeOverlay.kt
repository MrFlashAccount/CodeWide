package dev.codewide.app.prototype

import android.content.Context
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import dev.codewide.app.rendering.ParticlesOrbView
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbView
import kotlin.math.abs

/** Owns one real-size TYPE_APPLICATION_OVERLAY window for the debug visual check. */
internal class ParticlesOrbPrototypeOverlay(
  private val context: Context,
  private val onStateChanged: (VoiceAssistantOrbState) -> Unit,
) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private var view: DraggableParticlesOrbPrototype? = null

  fun show() {
    if (view != null) return
    val windowSize = dp(WINDOW_SIZE_DP)
    val bounds = windowManager.currentWindowMetrics.bounds
    val params = WindowManager.LayoutParams(
      windowSize,
      windowSize,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = (bounds.width() - windowSize) / 2
      y = (bounds.height() - windowSize) / 3
    }
    val overlay = DraggableParticlesOrbPrototype(
      context = context,
      onMove = { x, y -> move(params, x, y) },
      onStateChanged = onStateChanged,
    )
    windowManager.addView(overlay, params)
    view = overlay
    onStateChanged(overlay.state)
  }

  fun hide() {
    val overlay = view ?: return
    view = null
    runCatching { windowManager.removeView(overlay) }
  }

  fun setState(state: VoiceAssistantOrbState) {
    view?.setState(state)
    onStateChanged(state)
  }

  private fun move(params: WindowManager.LayoutParams, x: Int, y: Int) {
    val bounds = windowManager.currentWindowMetrics.bounds
    params.x = x.coerceIn(0, (bounds.width() - params.width).coerceAtLeast(0))
    params.y = y.coerceIn(0, (bounds.height() - params.height).coerceAtLeast(0))
    view?.let { overlay -> windowManager.updateViewLayout(overlay, params) }
  }

  private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  private companion object {
    private const val WINDOW_SIZE_DP = 76
  }
}

private class DraggableParticlesOrbPrototype(
  context: Context,
  private val onMove: (x: Int, y: Int) -> Unit,
  private val onStateChanged: (VoiceAssistantOrbState) -> Unit,
) : FrameLayout(context) {
  private val orb = ParticlesOrbView(context)
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var downRawX = 0f
  private var downRawY = 0f
  private var downWindowX = 0
  private var downWindowY = 0
  private var moved = false
  var state = VoiceAssistantOrbState.IDLE
    private set

  init {
    isClickable = true
    setState(state)
    addView(
      orb,
      LayoutParams(
        dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP),
        dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP),
      ).apply {
        gravity = Gravity.CENTER
      },
    )
  }

  fun setState(next: VoiceAssistantOrbState) {
    state = next
    contentDescription = "Particles Orb prototype: ${next.name.lowercase()}"
    orb.setOrbState(next)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downRawX = event.rawX
        downRawY = event.rawY
        downWindowX = (layoutParams as WindowManager.LayoutParams).x
        downWindowY = (layoutParams as WindowManager.LayoutParams).y
        moved = false
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        val deltaX = event.rawX - downRawX
        val deltaY = event.rawY - downRawY
        moved = moved || abs(deltaX) > touchSlop || abs(deltaY) > touchSlop
        if (moved) onMove(downWindowX + deltaX.toInt(), downWindowY + deltaY.toInt())
        return true
      }
      MotionEvent.ACTION_UP -> {
        if (!moved) performClick()
        return true
      }
      MotionEvent.ACTION_CANCEL -> return true
    }
    return super.onTouchEvent(event)
  }

  override fun performClick(): Boolean {
    super.performClick()
    val currentIndex = PROTOTYPE_STATES.indexOf(state)
    setState(PROTOTYPE_STATES[(currentIndex + 1) % PROTOTYPE_STATES.size])
    onStateChanged(state)
    return true
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private companion object {
    private val PROTOTYPE_STATES = listOf(
      VoiceAssistantOrbState.IDLE,
      VoiceAssistantOrbState.LISTENING,
      VoiceAssistantOrbState.SPEAKING,
    )
  }
}
