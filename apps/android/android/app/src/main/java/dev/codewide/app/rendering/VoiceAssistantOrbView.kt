package dev.codewide.app.rendering

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.graphics.Canvas
import android.view.Choreographer
import android.view.View

/** Closed renderer selection stored by the TypeScript settings owner. */
enum class VoiceAssistantOrbStyle(val wireValue: String) {
  NEBULA("nebula"),
  PARTICLES("particles");

  companion object {
    fun fromWireValue(value: String): VoiceAssistantOrbStyle =
      entries.firstOrNull { it.wireValue == value } ?: NEBULA
  }
}

/** State contract shared by every floating Voice Assistant renderer. */
enum class VoiceAssistantOrbState(val wireValue: String) {
  IDLE("idle"),
  CONNECTING("connecting"),
  LISTENING("listening"),
  THINKING("thinking"),
  SPEAKING("speaking"),
  ERROR("error"),
  DISABLED("disabled");

  companion object {
    fun fromWireValue(value: String): VoiceAssistantOrbState =
      entries.firstOrNull { it.wireValue == value } ?: IDLE
  }
}

/**
 * Owns the sole Choreographer callback for one attached renderer.
 * Removing a renderer from its slot synchronously cancels its clock before the replacement starts.
 */
abstract class VoiceAssistantOrbView(context: Context) : View(context), Choreographer.FrameCallback {
  protected var orbState = VoiceAssistantOrbState.IDLE
    private set
  protected var reducedMotion = false
    private set
  private var lastDiagnosticMs = Long.MIN_VALUE
  private var renderedFrames = 0L
  private var animationFrames = 0L
  private var diagnosticInput = 0.0
  private var diagnosticPlayback = 0.0

  protected fun recordAudioInput(input: Double, playback: Double) {
    diagnosticInput = if (input.isFinite()) input.coerceIn(0.0, 1.0) else 0.0
    diagnosticPlayback = if (playback.isFinite()) playback.coerceIn(0.0, 1.0) else 0.0
  }

  protected open fun rendererDiagnostic(): String = "style=unknown"

  protected fun recordRendererFrame() {
    renderedFrames += 1
    if (backdrop == null) return
    val now = SystemClock.elapsedRealtime()
    if (lastDiagnosticMs != Long.MIN_VALUE && now - lastDiagnosticMs < 1_000L) return
    lastDiagnosticMs = now
    Log.i("CodeWideVoiceRender", "renderer=${System.identityHashCode(this)} state=${orbState.wireValue} " +
      "reducedMotion=$reducedMotion frames=$renderedFrames animationFrames=$animationFrames rawInput=$diagnosticInput " +
      "rawPlayback=$diagnosticPlayback ${rendererDiagnostic()}")
  }

  private var backdrop: OrbBackdrop? = null
  private var backdropDeltaSeconds = 0f

  fun setBackdropEnabled(enabled: Boolean) {
    backdrop = if (enabled) backdrop ?: OrbBackdrop() else null
    invalidate()
  }

  protected fun drawBackdrop(canvas: Canvas, visualRadius: Float) {
    backdrop?.draw(canvas, width / 2f, height / 2f, visualRadius,
      3f * resources.displayMetrics.density, backdropDeltaSeconds, reducedMotion)
    backdropDeltaSeconds = 0f
  }

  private var attached = false
  private var framePosted = false
  private var lastFrameNanos = 0L

  fun setOrbState(state: VoiceAssistantOrbState) {
    if (orbState == state) return
    orbState = state
    lastDiagnosticMs = Long.MIN_VALUE
    onOrbStateChanged()
    invalidate()
  }

  abstract fun setAudioLevels(inputLevel: Double, playbackLevel: Double)

  fun setReducedMotion(reduced: Boolean) {
    if (reducedMotion == reduced) return
    reducedMotion = reduced
    lastDiagnosticMs = Long.MIN_VALUE
    lastFrameNanos = 0L
    if (reduced) {
      cancelFrame()
    } else {
      postFrame()
    }
    onReducedMotionChanged()
    invalidate()
  }

  protected open fun onOrbStateChanged() = Unit

  protected open fun onReducedMotionChanged() = Unit

  protected abstract fun advanceAnimation(deltaSeconds: Float)

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    postFrame()
  }

  override fun onDetachedFromWindow() {
    attached = false
    cancelFrame()
    lastFrameNanos = 0L
    super.onDetachedFromWindow()
  }

  final override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    if (!attached || reducedMotion) return
    val deltaSeconds = if (lastFrameNanos == 0L) {
      0f
    } else {
      ((frameTimeNanos - lastFrameNanos).coerceAtMost(MAX_FRAME_DELTA_NANOS) / 1_000_000_000.0).toFloat()
    }
    lastFrameNanos = frameTimeNanos
    animationFrames += 1
    backdropDeltaSeconds += deltaSeconds
    advanceAnimation(deltaSeconds)
    invalidate()
    postFrame()
  }

  private fun postFrame() {
    if (framePosted || !attached || reducedMotion) return
    framePosted = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun cancelFrame() {
    if (!framePosted) return
    Choreographer.getInstance().removeFrameCallback(this)
    framePosted = false
  }

  companion object {
    /** Shared production diameter for every floating-overlay renderer strategy. */
    const val TARGET_DIAMETER_DP = 66

    private const val MAX_FRAME_DELTA_NANOS = 66_666_667L
  }
}

/** The only construction boundary for the interchangeable floating-overlay renderers. */
internal object VoiceAssistantOrbRendererFactory {
  fun create(context: Context, style: VoiceAssistantOrbStyle): VoiceAssistantOrbView = when (style) {
    VoiceAssistantOrbStyle.NEBULA -> NebulaOrbView(context)
    VoiceAssistantOrbStyle.PARTICLES -> ParticlesOrbView(context)
  }
}
