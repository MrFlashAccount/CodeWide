package dev.codewide.app.remote

import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.content.Context
import android.graphics.PixelFormat
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.WindowMetrics
import android.widget.FrameLayout
import androidx.dynamicanimation.animation.FloatValueHolder
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import dev.codewide.app.rendering.VoiceAssistantOrbSlotView
import dev.codewide.app.rendering.VoiceAssistantOrbView
import kotlin.math.abs
import kotlin.math.sqrt

private const val OVERLAY_SPRING_CORRIDOR_SECONDS = 0.55f
private const val OVERLAY_SPRING_DAMPING_RATIO = 1f
private const val OVERLAY_SPRING_STIFFNESS = 420f
private const val OVERLAY_SPRING_MIN_VISIBLE_CHANGE = 0.5f

internal data class VoiceOverlayLaunchOrigin(
  val centerX: Float,
  val centerY: Float,
  val diameter: Float,
)

private data class ActiveOverlayWindowMotion(
  val corridor: OverlayMotionCorridor,
  val params: WindowManager.LayoutParams,
  val view: DraggableVoiceOverlay,
  var point: OverlayPoint,
)

/** Owns the permission-gated, draggable system window for one live Global Voice session. */
internal class GlobalVoiceOverlayController(
  private val context: Context,
  private val onMicrophoneToggle: () -> Unit,
  private val onStop: () -> Unit,
  initialMicrophoneMuted: Boolean,
  initialStyle: VoiceAssistantOrbStyle,
  initialState: VoiceAssistantOrbState,
  initialReducedMotion: Boolean,
  initialLaunchOrigin: VoiceOverlayLaunchOrigin?,
  private val currentDisplayMetrics: () -> WindowMetrics = {
    context.getSystemService(WindowManager::class.java).currentWindowMetrics
  },
) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  private var overlay: DraggableVoiceOverlay? = null
  private var overlayParams: WindowManager.LayoutParams? = null
  private var controls: VoiceOverlayControls? = null
  private var menuReturnPosition: OverlayPoint? = null
  private var springAnimation: OverlaySpringAnimation? = null
  private var activeWindowMotion: ActiveOverlayWindowMotion? = null
  private var pendingHideCompletion: (() -> Unit)? = null
  private val layoutSettler = VoiceOverlayLayoutSettler()
  private var reflowScheduled = false
  private var forceRemap = false
  private var visibilityGeneration = 0L
  private var orbStyle = initialStyle
  private var orbState = initialState
  private var reducedMotion = initialReducedMotion
  private var launchOrigin = initialLaunchOrigin
  private var microphoneMuted = initialMicrophoneMuted
  private var chatTarget: VoiceOverlayChatTarget? = null

  fun updateChatTarget(target: VoiceOverlayChatTarget?) {
    if (chatTarget == target) return
    chatTarget = target
    controls?.setChatAvailable(target != null)
  }

  fun show() {
    if (!Settings.canDrawOverlays(context)) return
    overlay?.let { view ->
      val interruptedHide = pendingHideCompletion
      if (interruptedHide === null) return
      visibilityGeneration += 1
      pendingHideCompletion = null
      cancelSnapAnimation()
      view.restoreVisualState()
      interruptedHide.invoke()
      return
    }
    visibilityGeneration += 1
    val size = dp(OVERLAY_SIZE_DP)
    val initialBounds = safeBounds(size)
    val params = overlayParams(size, initialBounds)
    val target = OverlayPoint(params.x.toFloat(), params.y.toFloat())
    if (!preferences.getFloat(POSITION_Y_FRACTION, Float.NaN).isFinite()) persistFree(target, initialBounds)
    val origin = launchOrigin.also { launchOrigin = null }
    if (origin != null && !reducedMotion) {
      params.x = (origin.centerX - size / 2f).toInt()
      params.y = (origin.centerY - size / 2f).toInt()
    }
    val view = DraggableVoiceOverlay(
      context = context,
      initialStyle = orbStyle,
      initialState = orbState,
      initialMicrophoneMuted = microphoneMuted,
      initialReducedMotion = reducedMotion,
      windowSize = size,
      onDragStart = {
        // A deliberate drag replaces the temporary menu placement with new user intent.
        menuReturnPosition = null
        controls?.collapse(reducedMotion, fast = true)
        cancelSnapAnimation()
      },
      onMove = { x, y -> moveDuringDrag(params, OverlayPoint(x.toFloat(), y.toFloat())) },
      onRelease = { x, y, velocityX, velocityY ->
        release(
          params,
          OverlayPoint(x.toFloat(), y.toFloat()),
          OverlayPoint(velocityX, velocityY),
        )
      },
      onTap = { toggleControls(params) },
    )
    view.setOnApplyWindowInsetsListener { _, insets ->
      // Window-local insets are not display insets. Treat the callback only as a signal.
      scheduleReflow()
      insets
    }
    if (origin != null && !reducedMotion) {
      // Prepare the launch transform before attaching the overlay. Otherwise WindowManager can
      // draw one full-size frame at the restored position before the header handoff is applied.
      view.startLaunchHandoff(origin.diameter)
    }
    try {
      windowManager.addView(view, params)
      overlay = view
      overlayParams = params
      view.setWindowPosition(OverlayPoint(params.x.toFloat(), params.y.toFloat()))
      if (origin != null && !reducedMotion) {
        animateSpring(
          params = params,
          start = OverlayPoint(params.x.toFloat(), params.y.toFloat()),
          target = target,
          velocity = OverlayPoint(0f, 0f),
          onFinish = {},
        )
      }
    } catch (_: SecurityException) {
      // Permission can be revoked between the explicit check and WindowManager admission.
    }
  }

  fun hide(returnTarget: VoiceOverlayLaunchOrigin?, onHidden: () -> Unit) {
    hideControls()
    val view = overlay
    val params = overlayParams
    if (view === null || params === null) {
      onHidden()
      return
    }
    val supersededHide = pendingHideCompletion
    pendingHideCompletion = null
    supersededHide?.invoke()
    pendingHideCompletion = onHidden
    visibilityGeneration += 1
    val generation = visibilityGeneration
    cancelSnapAnimation()
    if (reducedMotion) {
      removeOverlay(view)
      completePendingHide()
      return
    }
    if (returnTarget === null) {
      view.animateScaleOut {
        if (visibilityGeneration != generation || overlay !== view) return@animateScaleOut
        removeOverlay(view)
        completePendingHide()
      }
      return
    }
    val size = dp(OVERLAY_SIZE_DP)
    val start = OverlayPoint(params.x.toFloat(), params.y.toFloat())
    val target = OverlayPoint(
      returnTarget.centerX - size / 2f,
      returnTarget.centerY - size / 2f,
    )
    view.startReturnHandoff(returnTarget.diameter)
    animateSpring(
      params = params,
      start = start,
      target = target,
      velocity = OverlayPoint(0f, 0f),
      keepWindowAtTarget = false,
      onFinish = {
        if (visibilityGeneration != generation || overlay !== view) return@animateSpring
        removeOverlay(view)
        completePendingHide()
      },
    )
  }

  fun hideImmediately() {
    removeControls(restoreOrb = false)
    visibilityGeneration += 1
    cancelSnapAnimation(restoreWindow = false)
    overlay?.let(::removeOverlay)
    completePendingHide()
  }

  fun onConfigurationChanged() {
    if (overlayParams === null) return
    cancelSnapAnimation(restoreWindow = false)
    if (pendingHideCompletion != null) {
      overlay?.let(::removeOverlay)
      completePendingHide()
      return
    }
    forceRemap = true
    layoutSettler.resetCandidate()
    scheduleReflow()
  }

  fun updateAudioLevels(levels: GlobalVoiceAudioLevels) {
    if (!Settings.canDrawOverlays(context)) {
      hideImmediately()
      return
    }
    overlay?.setAudioLevels(levels)
  }

  fun updateOrbStyle(style: VoiceAssistantOrbStyle) {
    orbStyle = style
    overlay?.setOrbStyle(style)
  }

  fun updateOrbState(state: VoiceAssistantOrbState) {
    orbState = state
    overlay?.setOrbState(state)
  }

  fun updateMicrophoneMuted(muted: Boolean) {
    microphoneMuted = muted
    overlay?.setMicrophoneMuted(muted)
    controls?.setMicrophoneMuted(muted)
  }

  fun updateReducedMotion(reduced: Boolean) {
    reducedMotion = reduced
    overlay?.setReducedMotion(reduced)
    controls?.setReducedMotion(reduced)
  }

  fun updateLaunchOrigin(origin: VoiceOverlayLaunchOrigin) {
    launchOrigin = origin
  }

  fun clearLaunchOrigin() {
    launchOrigin = null
  }

  private fun overlayParams(size: Int, bounds: OverlaySafeBounds): WindowManager.LayoutParams {
    val restored = restorePosition(bounds)
    return WindowManager.LayoutParams(
      size,
      size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.LEFT
      setFitInsetsTypes(0)
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
      x = restored.x.toInt()
      y = restored.y.toInt()
    }
  }

  private fun moveExactly(params: WindowManager.LayoutParams, point: OverlayPoint) {
    params.x = point.x.toInt()
    params.y = point.y.toInt()
    overlay?.let { view ->
      runCatching { windowManager.updateViewLayout(view, params) }
        .onSuccess {
          view.setWindowPosition(OverlayPoint(params.x.toFloat(), params.y.toFloat()))
          controls?.moveOrb(OverlayPoint(params.x + params.width / 2f, params.y + params.height / 2f))
        }
    }
  }

  private fun moveDuringDrag(params: WindowManager.LayoutParams, point: OverlayPoint) {
    val bounds = safeBounds(dp(OVERLAY_SIZE_DP))
    moveExactly(
      params,
      GlobalVoiceOverlayPlacement.drag(point, bounds, dp(DRAG_OVERSCROLL_DP).toFloat()),
    )
  }

  private fun release(
    params: WindowManager.LayoutParams,
    point: OverlayPoint,
    velocity: OverlayPoint,
  ) {
    val bounds = safeBounds(dp(OVERLAY_SIZE_DP))
    when (
      val placement = GlobalVoiceOverlayPlacement.release(
        point,
        velocity,
        bounds,
        dp(SNAP_ZONE_DP).toFloat(),
      )
    ) {
      is OverlayReleasePlacement.Free -> {
        moveExactly(params, placement.point)
        persistFree(placement.point, bounds)
      }
      is OverlayReleasePlacement.Return -> animateSpring(
        params = params,
        start = placement.point,
        target = placement.target,
        velocity = placement.velocity,
        onFinish = { persistFree(placement.target, bounds) },
      )
      is OverlayReleasePlacement.Snap -> animateSpring(
        params = params,
        start = placement.point,
        target = placement.target,
        velocity = placement.velocity,
        onFinish = { persistSnap(placement.target, bounds) },
      )
    }
  }

  private fun animateSpring(
    params: WindowManager.LayoutParams,
    start: OverlayPoint,
    target: OverlayPoint,
    velocity: OverlayPoint,
    keepWindowAtTarget: Boolean = true,
    onFinish: () -> Unit,
  ) {
    cancelSnapAnimation()
    if (reducedMotion) {
      moveExactly(params, target)
      onFinish()
      return
    }
    val trajectory = OverlaySnapTrajectory(
      start,
      target,
      velocity,
      angularFrequency = sqrt(OVERLAY_SPRING_STIFFNESS),
    )
    val motion = beginWindowMotion(
      params,
      start,
      trajectory.motionBounds(OVERLAY_SPRING_CORRIDOR_SECONDS),
    )
    if (motion === null) {
      moveExactly(params, target)
      onFinish()
      return
    }
    activeWindowMotion = motion
    springAnimation = OverlaySpringAnimation(
      start = start,
      target = target,
      velocity = velocity,
      onFrame = { point ->
        if (activeWindowMotion === motion) {
          motion.point = point
          motion.view.setMotionPosition(motion.corridor.local(point))
        }
      },
      onFinish = {
        if (activeWindowMotion === motion) {
          motion.point = target
          motion.view.setMotionPosition(motion.corridor.local(target))
          if (keepWindowAtTarget) finishWindowMotion(motion, target)
          activeWindowMotion = null
          springAnimation = null
          onFinish()
        }
      },
    ).also(OverlaySpringAnimation::start)
  }

  private fun beginWindowMotion(
    params: WindowManager.LayoutParams,
    start: OverlayPoint,
    motionBounds: OverlayMotionBounds,
  ): ActiveOverlayWindowMotion? {
    val view = overlay ?: return null
    val corridor = OverlayMotionCorridor.containing(motionBounds, dp(OVERLAY_SIZE_DP))
    params.x = corridor.left
    params.y = corridor.top
    params.width = corridor.width
    params.height = corridor.height
    params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    val motion = runCatching {
      windowManager.updateViewLayout(view, params)
      view.beginWindowMotion(corridor.local(start))
      ActiveOverlayWindowMotion(corridor, params, view, start)
    }.getOrNull()
    if (motion !== null) return motion
    val size = dp(OVERLAY_SIZE_DP)
    params.x = start.x.toInt()
    params.y = start.y.toInt()
    params.width = size
    params.height = size
    params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    runCatching { windowManager.updateViewLayout(view, params) }
    view.endWindowMotion()
    view.setWindowPosition(OverlayPoint(params.x.toFloat(), params.y.toFloat()))
    return null
  }

  private fun finishWindowMotion(motion: ActiveOverlayWindowMotion, point: OverlayPoint) {
    val size = dp(OVERLAY_SIZE_DP)
    motion.params.x = point.x.toInt()
    motion.params.y = point.y.toInt()
    motion.params.width = size
    motion.params.height = size
    motion.params.flags = motion.params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    runCatching { windowManager.updateViewLayout(motion.view, motion.params) }
      .onSuccess {
        motion.view.endWindowMotion()
        motion.view.setWindowPosition(
          OverlayPoint(motion.params.x.toFloat(), motion.params.y.toFloat()),
        )
      }
  }

  private fun cancelSnapAnimation(restoreWindow: Boolean = true) {
    springAnimation?.cancel()
    springAnimation = null
    val motion = activeWindowMotion
    activeWindowMotion = null
    if (restoreWindow && motion !== null) finishWindowMotion(motion, motion.point)
  }

  private fun removeOverlay(view: DraggableVoiceOverlay) {
    if (overlay !== view) return
    removeControls(restoreOrb = false)
    view.cancelVisualAnimations()
    overlay = null
    overlayParams = null
    view.removeCallbacks(stabilizeLayout)
    reflowScheduled = false
    activeWindowMotion = null
    springAnimation = null
    runCatching { windowManager.removeView(view) }
  }

  private fun completePendingHide() {
    val completion = pendingHideCompletion ?: return
    pendingHideCompletion = null
    completion()
  }

  private val stabilizeLayout = object : Runnable {
    override fun run() {
      val view = overlay ?: run { reflowScheduled = false; return }
      val layout = displayLayout()
      if (!layoutSettler.observe(layout)) {
        view.postOnAnimation(this)
        return
      }
      reflowScheduled = false
      if (layoutSettler.commit(layout) || forceRemap) {
        forceRemap = false
        reflow(layout)
      }
    }
  }

  private fun scheduleReflow() {
    val view = overlay ?: return
    if (reflowScheduled) return
    reflowScheduled = true
    view.postOnAnimation(stabilizeLayout)
  }

  private fun reflow(layout: VoiceOverlayDisplayLayout) {
    val params = overlayParams ?: return
    val bounds = layout.bounds(dp(OVERLAY_SIZE_DP))
    cancelSnapAnimation(restoreWindow = false)
    val size = dp(OVERLAY_SIZE_DP)
    params.width = size
    params.height = size
    params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    overlay?.endWindowMotion()
    // Remap the saved user intent. Do not persist this configuration-induced position.
    val restored = restorePosition(bounds)
    if (controls == null) {
      moveExactly(params, restored)
      return
    }
    val geometry = voiceOverlayMenuGeometry(
      OverlayPoint(restored.x + size / 2f, restored.y + size / 2f), layout.area,
      context.resources.displayMetrics.density,
    )
    if (geometry == null) {
      removeControls(restoreOrb = false)
      moveExactly(params, restored)
    } else {
      menuReturnPosition = restored
      controls?.updateGeometry(geometry)
      moveExactly(params, OverlayPoint(geometry.orbCenter.x - size / 2f, geometry.orbCenter.y - size / 2f))
    }
  }

  private fun displayLayout(): VoiceOverlayDisplayLayout {
    val metrics = currentDisplayMetrics()
    val width = metrics.bounds.width()
    val height = metrics.bounds.height()
    return VoiceOverlayDisplayLayout(width, height, voiceOverlaySafeBounds(
      width, height, metrics.windowInsets, 0, 0, dp(SAFE_MARGIN_DP).toFloat(),
    ))
  }

  private fun safeBounds(elementWidth: Int): OverlaySafeBounds = displayLayout().bounds(elementWidth)

  private fun restorePosition(bounds: OverlaySafeBounds): OverlayPoint {
    val normalizedY = preferences.getFloat(POSITION_Y_FRACTION, Float.NaN)
    if (normalizedY.isFinite()) {
      val y = GlobalVoiceOverlayPlacement.restore(OverlayPoint(0f, normalizedY), bounds).y
      return when (preferences.getString(POSITION_MODE, POSITION_FREE)) {
        POSITION_LEFT -> OverlayPoint(bounds.minX, y)
        POSITION_RIGHT -> OverlayPoint(bounds.maxX, y)
        else -> GlobalVoiceOverlayPlacement.restore(
          OverlayPoint(preferences.getFloat(POSITION_X_FRACTION, 1f), normalizedY),
          bounds,
        )
      }
    }
    return bounds.clamp(
      OverlayPoint(
        preferences.getInt(POSITION_X, bounds.maxX.toInt()).toFloat(),
        preferences.getInt(POSITION_Y, dp(112)).toFloat(),
      ),
    )
  }

  private fun persistFree(point: OverlayPoint, bounds: OverlaySafeBounds) {
    persist(point, bounds, POSITION_FREE)
  }

  private fun persistSnap(point: OverlayPoint, bounds: OverlaySafeBounds) {
    val mode = if (abs(point.x - bounds.minX) <= abs(point.x - bounds.maxX)) {
      POSITION_LEFT
    } else {
      POSITION_RIGHT
    }
    persist(point, bounds, mode)
  }

  private fun persist(point: OverlayPoint, bounds: OverlaySafeBounds, mode: String) {
    val normalized = GlobalVoiceOverlayPlacement.normalize(point, bounds)
    preferences.edit()
      .putFloat(POSITION_X_FRACTION, normalized.x)
      .putFloat(POSITION_Y_FRACTION, normalized.y)
      .putString(POSITION_MODE, mode)
      .apply()
  }

  private fun toggleControls(params: WindowManager.LayoutParams) {
    val panel = controls
    if (panel == null) showControls(params) else panel.toggle(reducedMotion)
  }

  private fun showControls(orbParams: WindowManager.LayoutParams) {
    if (controls !== null || !Settings.canDrawOverlays(context)) return
    val orbView = overlay ?: return
    cancelSnapAnimation()
    val geometry = voiceOverlayMenuGeometry(
      OverlayPoint(orbParams.x + orbParams.width / 2f, orbParams.y + orbParams.height / 2f),
      safeBounds(0),
      context.resources.displayMetrics.density,
    ) ?: return
    menuReturnPosition = OverlayPoint(orbParams.x.toFloat(), orbParams.y.toFloat())
    // Translate the complete menu, never clamp individual action centers or persist this offset.
    moveExactly(orbParams, OverlayPoint(
      geometry.orbCenter.x - orbParams.width / 2f, geometry.orbCenter.y - orbParams.height / 2f,
    ))
    val panel = VoiceOverlayControls(
      context,
      geometry,
      microphoneMuted = microphoneMuted,
      onMicrophoneToggle = { onMicrophoneToggle() },
      onOpenApp = {
        hideControls()
        context.startActivity(Intent(context, dev.codewide.app.MainActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
      },
      onStop = {
        hideControls()
        onStop()
      },
      onSettings = {
        hideControls()
        context.startActivity(voiceAssistantSettingsIntent(context))
      },
      onOpenChat = {
        chatTarget?.let { target ->
          hideControls()
          context.startActivity(target.intent(context))
        }
      },
      chatAvailable = chatTarget != null,
      orbContains = orbView::containsScreenPoint,
      onOrbTouch = orbView::onTouchEvent,
      onExpansionChanged = orbView::setActionsExpanded,
      onCollapsed = { removeControls() },
    )
    try {
      controls = panel
      panel.show(reducedMotion)
    } catch (_: SecurityException) {
      removeControls()
      // Revocation closes the interaction without affecting media cleanup.
    } catch (_: WindowManager.BadTokenException) {
      removeControls()
      // The service/display may disappear before all five action windows attach.
    }
  }

  private fun hideControls() {
    controls?.collapse(reducedMotion)
  }

  private fun removeControls(restoreOrb: Boolean = true) {
    val returnPosition = menuReturnPosition
    menuReturnPosition = null
    val view = controls
    controls = null
    overlay?.setActionsExpanded(false)
    view?.dispose()
    val params = overlayParams
    if (restoreOrb && pendingHideCompletion == null && returnPosition != null && params != null) {
      moveExactly(params, returnPosition)
    }
  }

  private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  private companion object {
    private const val DRAG_OVERSCROLL_DP = 20
    private const val OVERLAY_SIZE_DP = 76
    private const val PREFERENCES = "global_voice_overlay"
    private const val POSITION_FREE = "free"
    private const val POSITION_LEFT = "left"
    private const val POSITION_MODE = "mode"
    private const val POSITION_RIGHT = "right"
    private const val POSITION_X = "x"
    private const val POSITION_X_FRACTION = "x_fraction"
    private const val POSITION_Y = "y"
    private const val POSITION_Y_FRACTION = "y_fraction"
    private const val SAFE_MARGIN_DP = 8
    private const val SNAP_ZONE_DP = 16
  }
}

private class DraggableVoiceOverlay(
  context: Context,
  initialStyle: VoiceAssistantOrbStyle,
  initialState: VoiceAssistantOrbState,
  initialMicrophoneMuted: Boolean,
  initialReducedMotion: Boolean,
  private val windowSize: Int,
  private val onDragStart: () -> Unit,
  private val onMove: (x: Int, y: Int) -> Unit,
  private val onRelease: (x: Int, y: Int, velocityX: Float, velocityY: Float) -> Unit,
  private val onTap: () -> Unit,
) : FrameLayout(context) {
  private val gesture = OverlayGestureThreshold(ViewConfiguration.get(context).scaledTouchSlop.toFloat())
  private var audioLevels = GlobalVoiceAudioLevels(0.0, 0.0, 0.0)
  private var orbStyle = initialStyle
  private var orbState = initialState
  private var reducedMotion = initialReducedMotion
  private var microphoneMuted = initialMicrophoneMuted
  private val orb = VoiceAssistantOrbSlotView(context).also { slot ->
    slot.setBackdropEnabled(true)
    slot.setOrbStyle(initialStyle)
    slot.setOrbState(initialState)
    slot.setMicrophoneMuted(initialMicrophoneMuted)
    slot.setReducedMotion(initialReducedMotion)
  }
  private val orbHost = FrameLayout(context).also { host ->
    host.clipChildren = false
    host.addView(orb, orbLayoutParams())
  }
  private val orbBounds = Rect()

  fun containsScreenPoint(x: Float, y: Float): Boolean {
    val position = IntArray(2)
    orbHost.getLocationOnScreen(position)
    orbBounds.set(position[0], position[1], position[0] + orbHost.width, position[1] + orbHost.height)
    return orbBounds.contains(x.toInt(), y.toInt())
  }

  private val dragCoordinates = OverlayDragCoordinates()
  private var dragStarted = false
  private var velocityTracker: VelocityTracker? = null

  init {
    updateContentDescription()
    setActionsExpanded(false)
    isClickable = true
    addView(
      orbHost,
      LayoutParams(windowSize, windowSize).apply {
        gravity = Gravity.TOP or Gravity.START
      },
    )
  }

  fun setAudioLevels(levels: GlobalVoiceAudioLevels) {
    audioLevels = levels
    val input = if (orbStyle == VoiceAssistantOrbStyle.PARTICLES) levels.particlesInput else levels.input
    orb.setAudioLevels(input, levels.playback)
  }

  fun setWindowPosition(point: OverlayPoint) {
    dragCoordinates.updateAppliedPosition(point)
  }

  fun setOrbStyle(style: VoiceAssistantOrbStyle) {
    if (orbStyle == style) return
    orbStyle = style
    orb.setOrbStyle(style)
    setAudioLevels(audioLevels)
    updateContentDescription()
  }

  fun setOrbState(state: VoiceAssistantOrbState) {
    orbState = state
    orb.setOrbState(state)
    updateContentDescription()
  }

  fun setMicrophoneMuted(muted: Boolean) {
    microphoneMuted = muted
    orb.setMicrophoneMuted(muted)
    updateContentDescription()
  }

  fun setActionsExpanded(expanded: Boolean) {
    stateDescription = if (expanded) "Actions expanded" else "Actions collapsed"
  }

  fun setReducedMotion(reduced: Boolean) {
    reducedMotion = reduced
    orb.setReducedMotion(reduced)
  }

  fun startLaunchHandoff(sourceDiameter: Float) {
    val scale = (sourceDiameter / dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP))
      .coerceIn(MIN_HANDOFF_SCALE, 1f)
    orbHost.scaleX = scale
    orbHost.scaleY = scale
    orbHost.animate()
      .scaleX(1f)
      .scaleY(1f)
      .setDuration(HANDOFF_SCALE_DURATION_MS)
      .start()
  }

  fun startReturnHandoff(targetDiameter: Float) {
    val scale = (targetDiameter / dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP))
      .coerceIn(MIN_HANDOFF_SCALE, 1f)
    orbHost.animate()
      .scaleX(scale)
      .scaleY(scale)
      .setDuration(RETURN_DURATION_MS)
      .start()
  }

  fun animateScaleOut(onFinish: () -> Unit) {
    orbHost.animate()
      .alpha(0f)
      .scaleX(MIN_HANDOFF_SCALE)
      .scaleY(MIN_HANDOFF_SCALE)
      .setDuration(SCALE_OUT_DURATION_MS)
      .withEndAction(onFinish)
      .start()
  }

  fun beginWindowMotion(localStart: OverlayPoint) {
    setMotionPosition(localStart)
  }

  fun setMotionPosition(localPoint: OverlayPoint) {
    orbHost.translationX = localPoint.x
    orbHost.translationY = localPoint.y
  }

  fun endWindowMotion() {
    orbHost.translationX = 0f
    orbHost.translationY = 0f
  }

  fun restoreVisualState() {
    cancelVisualAnimations()
    orbHost.alpha = 1f
    orbHost.scaleX = 1f
    orbHost.scaleY = 1f
  }

  fun cancelVisualAnimations() {
    orbHost.animate().cancel()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragCoordinates.begin(OverlayPoint(event.rawX, event.rawY))
        gesture.begin(OverlayPoint(event.rawX, event.rawY))
        dragStarted = false
        velocityTracker?.recycle()
        velocityTracker = VelocityTracker.obtain().also { it.addMovement(event) }
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        velocityTracker?.addMovement(event)
        val dragging = gesture.move(OverlayPoint(event.rawX, event.rawY))
        if (dragging) {
          if (!dragStarted) {
            dragStarted = true
            onDragStart()
          }
          val requested = dragCoordinates.requestedPosition(OverlayPoint(event.rawX, event.rawY))
          onMove(requested.x.toInt(), requested.y.toInt())
        }
        return true
      }
      MotionEvent.ACTION_UP -> {
        velocityTracker?.addMovement(event)
        velocityTracker?.computeCurrentVelocity(1_000)
        if (gesture.finish() === OverlayGestureResult.DRAG) {
          val position = dragCoordinates.currentPosition
          onRelease(
            position.x.toInt(),
            position.y.toInt(),
            velocityTracker?.xVelocity ?: 0f,
            velocityTracker?.yVelocity ?: 0f,
          )
        } else {
          performClick()
        }
        recycleVelocityTracker()
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        if (gesture.finish() === OverlayGestureResult.DRAG) {
          val position = dragCoordinates.currentPosition
          onRelease(position.x.toInt(), position.y.toInt(), 0f, 0f)
        }
        recycleVelocityTracker()
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  override fun performClick(): Boolean {
    super.performClick()
    onTap()
    return true
  }

  private fun recycleVelocityTracker() {
    velocityTracker?.recycle()
    velocityTracker = null
  }

  private fun orbLayoutParams(): LayoutParams =
    LayoutParams(
      dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP),
      dp(VoiceAssistantOrbView.TARGET_DIAMETER_DP),
    ).apply {
      gravity = Gravity.CENTER
    }

  private fun updateContentDescription() {
    val microphone = if (microphoneMuted) "microphone off" else "microphone on"
    contentDescription =
      "Voice Assistant controls, ${orbStyle.wireValue} orb, ${orbState.wireValue}, $microphone"
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private companion object {
    private const val HANDOFF_SCALE_DURATION_MS = 320L
    private const val MIN_HANDOFF_SCALE = 0.35f
    private const val RETURN_DURATION_MS = 550L
    private const val SCALE_OUT_DURATION_MS = 180L
  }
}

private class OverlaySpringAnimation(
  start: OverlayPoint,
  private val target: OverlayPoint,
  velocity: OverlayPoint,
  private val onFrame: (OverlayPoint) -> Unit,
  private val onFinish: () -> Unit,
) {
  private var cancelled = false
  private var current = start
  private var xFinished = false
  private var yFinished = false
  private val xAnimation = spring(start.x, target.x, velocity.x)
  private val yAnimation = spring(start.y, target.y, velocity.y)

  init {
    xAnimation.addUpdateListener { _, value, _ ->
      current = OverlayPoint(value, current.y)
      onFrame(current)
    }
    yAnimation.addUpdateListener { _, value, _ ->
      current = OverlayPoint(current.x, value)
      onFrame(current)
    }
    xAnimation.addEndListener { _, wasCancelled, _, _ ->
      if (!wasCancelled) {
        xFinished = true
        finishIfSettled()
      }
    }
    yAnimation.addEndListener { _, wasCancelled, _, _ ->
      if (!wasCancelled) {
        yFinished = true
        finishIfSettled()
      }
    }
  }

  fun start() {
    xAnimation.start()
    yAnimation.start()
  }

  fun cancel() {
    cancelled = true
    if (xAnimation.isRunning) xAnimation.cancel()
    if (yAnimation.isRunning) yAnimation.cancel()
  }

  private fun finishIfSettled() {
    if (!cancelled && xFinished && yFinished) {
      current = target
      onFrame(target)
      onFinish()
    }
  }

  private fun spring(start: Float, target: Float, velocity: Float): SpringAnimation =
    SpringAnimation(FloatValueHolder(start)).apply {
      setMinimumVisibleChange(OVERLAY_SPRING_MIN_VISIBLE_CHANGE)
      setStartVelocity(velocity)
      spring = SpringForce(target).apply {
        dampingRatio = OVERLAY_SPRING_DAMPING_RATIO
        stiffness = OVERLAY_SPRING_STIFFNESS
      }
    }
}

/** Uses the existing app scheme and route; opening settings does not end the voice session. */
internal fun voiceAssistantSettingsIntent(context: Context): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse("codewide:///settings?section=voice-assistant&request=${java.util.UUID.randomUUID()}"))
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
