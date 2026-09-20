package dev.codewide.app.rendering

import android.app.Activity
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import java.lang.ref.WeakReference

/**
 * Renders the voice aura in one non-interactive window attached to the current application.
 * The window stays above CodeWide dialogs and sheets without requiring system-overlay access.
 */
class VoiceAuraOverlay(
  private val context: ReactApplicationContext,
) : Choreographer.FrameCallback {
  private var shader: RuntimeShader? = null
  private var shaderWidth = 0
  private var shaderHeight = 0
  private var shaderDensity = Float.NaN
  private var overlayView: VoiceAuraOverlayView? = null
  private var windowManager: WindowManager? = null
  private var activity: WeakReference<Activity>? = null
  private var framePosted = false
  private var requestedActive = false
  private var reducedMotion = false
  private val envelope = VoiceAuraEnvelope()
  private var originScreenX: Float? = null
  private var originScreenY: Float? = null
  private var contentTarget: WeakReference<View>? = null
  private val location = IntArray(2)
  private var intensity = 0f
  private val transition = VoiceAuraTransition()
  private val contentEffect = VoiceAuraContentEffect()
  private val framePacer = VoiceAuraFramePacer()
  private var lastFrameNanos = 0L
  private var elapsedSeconds = 0f
  private val mainHandler = Handler(Looper.getMainLooper())
  private val forceClose = Runnable {
    if (!requestedActive) {
      transition.reset()
      intensity = 0f
      removeOverlay()
    }
  }

  /** Capture screen coordinates once; the overlay resolves them against its live bounds. */
  fun setOrigin(source: View?) {
    if (source == null || source.width <= 0 || source.height <= 0) {
      originScreenX = null
      originScreenY = null
      contentTarget = null
      return
    }
    source.getLocationOnScreen(location)
    originScreenX = location[0] + source.width / 2f
    originScreenY = location[1] + source.height / 2f
    contentTarget = WeakReference(source.rootView)
  }

  /** Level updates do not start/stop the effect or reset its intro. */
  fun setLevel(rawLevel: Double) {
    envelope.accept(rawLevel)
    if (transition.isVisible) {
      ensureOverlay()
      postFrame()
    }
  }

  fun update(active: Boolean, rawLevel: Double, reduceMotion: Boolean) {
    check(android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
      "Voice aura must be updated on the UI thread"
    }
    val stateChanged = active != requestedActive
    mainHandler.removeCallbacks(forceClose)
    requestedActive = active
    reducedMotion = reduceMotion
    envelope.accept(if (active) rawLevel else 0.0)

    if (active && stateChanged && intensity == 0f) {
      elapsedSeconds = 0f
      lastFrameNanos = 0L
    }

    transition.setActive(active, reduceMotion)
    intensity = transition.value

    if (transition.isVisible) {
      ensureOverlay()
      postFrame()
      if (!active) {
        mainHandler.postDelayed(forceClose, CLOSE_FALLBACK_MILLIS)
      }
    } else {
      removeOverlay()
    }
  }

  fun clear() {
    mainHandler.removeCallbacks(forceClose)
    requestedActive = false
    envelope.reset()
    transition.reset()
    intensity = 0f
    if (framePosted) {
      Choreographer.getInstance().removeFrameCallback(this)
      framePosted = false
    }
    removeOverlay()
  }

  override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    val view = ensureOverlay() ?: return
    val deltaSeconds = if (lastFrameNanos == 0L) {
      0f
    } else {
      ((frameTimeNanos - lastFrameNanos).coerceAtMost(MAX_FRAME_DELTA_NANOS) / 1_000_000_000.0).toFloat()
    }
    lastFrameNanos = frameTimeNanos

    intensity = transition.advance(deltaSeconds)
    if (!reducedMotion && (requestedActive || intensity > 0f)) {
      elapsedSeconds = (elapsedSeconds + if (requestedActive) deltaSeconds else -deltaSeconds).coerceAtLeast(0f)
    }
    envelope.advance(deltaSeconds)

    if (!transition.isVisible) {
      mainHandler.removeCallbacks(forceClose)
      removeOverlay()
      return
    }
    if (reducedMotion || framePacer.shouldDraw(frameTimeNanos)) {
      updateFrame(view)
    }
    if (!reducedMotion) {
      postFrame()
    }
  }

  private fun updateFrame(view: VoiceAuraOverlayView) {
    if (reducedMotion) {
      contentEffect.clear()
    } else {
      resolveContentTarget()?.let { target ->
        contentEffect.draw(
          target,
          intensity,
          transition.opacity,
          originScreenX,
          originScreenY,
        )
      }
    }
    if (view.width <= 0 || view.height <= 0) return
    val runtimeShader = shaderFor(view)
    runtimeShader.setFloatUniform("iTime", elapsedSeconds)
    runtimeShader.setFloatUniform("intensity", intensity)
    runtimeShader.setFloatUniform("uLevel", if (reducedMotion) 0f else envelope.value)
    runtimeShader.setFloatUniform("uIntro", intensity)
    runtimeShader.setFloatUniform("uOpacity", transition.opacity)
    runtimeShader.setFloatUniform("uMotion", if (reducedMotion) 0f else 1f)
    setOriginUniform(runtimeShader, view)
    view.setAuraShader(runtimeShader)
  }

  private fun shaderFor(view: View): RuntimeShader {
    val current = shader
    if (current != null) {
      configureShaderGeometry(current, view)
      return current
    }
    return RuntimeShader(SHADER_SOURCE).also { runtimeShader ->
      runtimeShader.setIntUniform("uColorCount", 5)
      runtimeShader.setFloatUniform("uColor0", 1f, 107f / 255f, 157f / 255f)
      runtimeShader.setFloatUniform("uColor1", 196f / 255f, 74f / 255f, 1f)
      runtimeShader.setFloatUniform("uColor2", 88f / 255f, 86f / 255f, 214f / 255f)
      runtimeShader.setFloatUniform("uColor3", 0f, 201f / 255f, 1f)
      runtimeShader.setFloatUniform("uColor4", 1f, 107f / 255f, 157f / 255f)
      runtimeShader.setFloatUniform("uColor5", 0f, 0f, 0f)
      runtimeShader.setFloatUniform("uColor6", 0f, 0f, 0f)
      runtimeShader.setFloatUniform("uColor7", 0f, 0f, 0f)
      configureShaderGeometry(runtimeShader, view)
      shader = runtimeShader
    }
  }

  private fun configureShaderGeometry(runtimeShader: RuntimeShader, view: View) {
    val density = view.resources.displayMetrics.density
    if (shaderWidth != view.width || shaderHeight != view.height) {
      shaderWidth = view.width
      shaderHeight = view.height
      runtimeShader.setFloatUniform("iResolution", view.width.toFloat(), view.height.toFloat())
    }
    if (shaderDensity != density) {
      shaderDensity = density
      runtimeShader.setFloatUniform("uDensity", density)
      runtimeShader.setFloatUniform("uRadius", 48f * density)
    }
  }

  private fun setOriginUniform(runtimeShader: RuntimeShader, view: View) {
    val screenX = originScreenX
    val screenY = originScreenY
    if (screenX == null || screenY == null) {
      runtimeShader.setFloatUniform("uWaveOrigin", 0.5f, 1f)
      return
    }
    view.getLocationOnScreen(location)
    runtimeShader.setFloatUniform(
      "uWaveOrigin",
      ((screenX - location[0]) / view.width).coerceIn(0f, 1f),
      ((screenY - location[1]) / view.height).coerceIn(0f, 1f),
    )
  }

  private fun resolveContentTarget(): View? {
    val requested = contentTarget?.get()?.takeIf(View::isAttachedToWindow)
    if (requested != null) return requested
    val currentActivity = context.currentActivity ?: activity?.get() ?: return null
    return currentActivity.findViewById(android.R.id.content) ?: currentActivity.window.decorView
  }

  private fun ensureOverlay(): VoiceAuraOverlayView? {
    val currentActivity = context.currentActivity ?: return overlayView?.takeIf(View::isAttachedToWindow)
    val currentView = overlayView
    if (activity?.get() === currentActivity && currentView?.isAttachedToWindow == true) {
      return currentView
    }
    removeOverlay()

    val token = currentActivity.window.decorView.windowToken ?: return null
    val manager = currentActivity.windowManager
    val view = VoiceAuraOverlayView(currentActivity)
    try {
      manager.addView(view, createLayoutParams(token))
    } catch (error: RuntimeException) {
      Log.w(LOG_TAG, "Could not attach application voice aura overlay", error)
      return null
    }
    activity = WeakReference(currentActivity)
    windowManager = manager
    overlayView = view
    return view
  }

  private fun removeOverlay() {
    val view = overlayView
    val manager = windowManager
    overlayView = null
    windowManager = null
    activity = null
    if (view?.isAttachedToWindow == true && manager != null) {
      try {
        manager.removeViewImmediate(view)
      } catch (error: RuntimeException) {
        Log.w(LOG_TAG, "Could not remove application voice aura overlay", error)
      }
    }
    shader = null
    shaderWidth = 0
    shaderHeight = 0
    shaderDensity = Float.NaN
    contentEffect.clear()
    framePacer.reset()
    lastFrameNanos = 0L
  }

  private fun createLayoutParams(token: android.os.IBinder): WindowManager.LayoutParams =
    WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_ATTACHED_DIALOG,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      this.token = token
      gravity = Gravity.START or Gravity.TOP
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
      title = "CodeWide voice aura"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        setFitInsetsTypes(0)
      }
    }

  private fun postFrame() {
    if (framePosted) return
    framePosted = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  private companion object {
    private const val LOG_TAG = "CodeWideVoiceAura"
    // Let the final 60 Hz animation frame remove the window before the lifecycle fallback does.
    private const val ONE_FRAME_MILLIS = 1_000L / 60L + 1L
    private const val CLOSE_FALLBACK_MILLIS =
      VoiceAuraTransition.CLOSE_DURATION_MILLIS + ONE_FRAME_MILLIS
    private const val MAX_FRAME_DELTA_NANOS = 66_666_667L
    // Adapted from Reacticx 1.21.0, MIT, Copyright (c) 2026 rit3zh.
    private const val SHADER_SOURCE = """
      uniform float iTime;
      uniform float intensity;
      uniform float2 iResolution;
      uniform float uDensity;
      uniform float uLevel;
      uniform float uIntro;
      uniform float uOpacity;
      uniform float uMotion;
      uniform float uRadius;
      uniform float2 uWaveOrigin;
      uniform int uColorCount;
      uniform float3 uColor0;
      uniform float3 uColor1;
      uniform float3 uColor2;
      uniform float3 uColor3;
      uniform float3 uColor4;
      uniform float3 uColor5;
      uniform float3 uColor6;
      uniform float3 uColor7;

      float perimeterPosition(float2 p, float2 b, float radius) {
        float arc = 1.5707963 * radius;
        float2 q = abs(p) - b;
        if (q.x > 0.0 && q.y > 0.0) {
          float angle = atan(q.y, q.x) * radius;
          if (p.x >= 0.0) {
            if (p.y < 0.0) return 2.0 * b.x + arc - angle;
            return 2.0 * b.x + arc + 2.0 * b.y + angle;
          }
          if (p.y >= 0.0) return 4.0 * b.x + 3.0 * arc + 2.0 * b.y - angle;
          return 4.0 * b.x + 3.0 * arc + 4.0 * b.y + angle;
        }
        if (q.x > q.y) {
          if (p.x >= 0.0) return 2.0 * b.x + arc + clamp(p.y + b.y, 0.0, 2.0 * b.y);
          return 4.0 * b.x + 3.0 * arc + 2.0 * b.y + clamp(b.y - p.y, 0.0, 2.0 * b.y);
        }
        if (p.y < 0.0) return clamp(p.x + b.x, 0.0, 2.0 * b.x);
        return 2.0 * b.x + 2.0 * arc + 2.0 * b.y + clamp(b.x - p.x, 0.0, 2.0 * b.x);
      }

      float3 getColor(int idx) {
        if (idx == 0) return uColor0;
        if (idx == 1) return uColor1;
        if (idx == 2) return uColor2;
        if (idx == 3) return uColor3;
        if (idx == 4) return uColor4;
        if (idx == 5) return uColor5;
        if (idx == 6) return uColor6;
        return uColor7;
      }

      float3 sampleGradient(float t) {
        float ft = fract(t) * float(uColorCount);
        int i0 = int(floor(ft));
        int i1 = i0 + 1;
        if (i1 >= uColorCount) i1 = 0;
        float f = fract(ft);
        f = f * f * (3.0 - 2.0 * f);
        return mix(getColor(i0), getColor(i1), f);
      }

      half4 main(float2 fragCoord) {
        float2 halfSize = iResolution * 0.5;
        float radius = min(uRadius, min(halfSize.x, halfSize.y) * 0.5);
        float2 b = halfSize - radius;
        float2 p = fragCoord - halfSize;
        float2 q = abs(p) - b;
        float signedDistance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        float inset = abs(signedDistance);
        float perimeter = 4.0 * (b.x + b.y) + 6.2831853 * radius;
        float position = perimeterPosition(p, b, radius);
        float2 origin = uWaveOrigin * iResolution;
        float distanceFromOrigin = length(fragCoord - origin);
        float reach = max(1.0, length(max(origin, iResolution - origin)));
        float duration = reach / (1200.0 * uDensity) + 1.2;
        float front = uIntro * duration - distanceFromOrigin / (1200.0 * uDensity);
        float reveal = smoothstep(0.0, 0.08, front);
        float phase = position / perimeter;
        float drift = 0.65 * sin(phase * 12.56637 - iTime * 0.6)
          + 0.35 * sin(phase * 18.84956 + iTime * 0.4);
        float width = (10.0 + 18.0 * uLevel + 1.5 * drift) * uDensity;
        float edgeGlow = exp(-inset * inset / (width * width));
        edgeGlow *= 1.0 - smoothstep(width * 2.0, width * 3.0, inset);
        float3 glow = sampleGradient(phase + iTime * 0.035 + 0.025 * drift);

        float time = max(0.0, front);
        float ripple = abs(sin(15.0 * time)) * exp(-8.0 * time) * uMotion;
        float haloRadius = (18.0 + 18.0 * smoothstep(0.0, 0.25, uIntro)) * uDensity;
        float haloBand = (distanceFromOrigin - haloRadius) / (8.0 * uDensity);
        float halo = exp(-haloBand * haloBand) * (1.0 - smoothstep(0.1, 0.35, uIntro));
        float alpha = intensity * clamp(
          edgeGlow * reveal * (0.55 + 0.4 * uLevel + 0.18 * ripple) + halo * 0.55,
          0.0,
          1.0
        ) * uOpacity;
        return half4(half3(glow) * half(alpha), half(alpha));
      }
    """
  }
}

/** Distorts the live pixels in the window where capture started; the glow lives above it. */
private class VoiceAuraContentEffect {
  private var shader: RuntimeShader? = null
  private var target: View? = null
  private var effectApplied = false
  private val location = IntArray(2)

  fun draw(
    nextTarget: View,
    intro: Float,
    opacity: Float,
    originScreenX: Float?,
    originScreenY: Float?,
  ) {
    if (nextTarget.width <= 0 || nextTarget.height <= 0) return
    if (target !== nextTarget) {
      clear()
      target = nextTarget
    }
    val runtimeShader = shader ?: RuntimeShader(SHADER_SOURCE).also { shader = it }
    val density = nextTarget.resources.displayMetrics.density
    runtimeShader.setFloatUniform("iResolution", nextTarget.width.toFloat(), nextTarget.height.toFloat())
    runtimeShader.setFloatUniform("uDensity", density)
    runtimeShader.setFloatUniform("uIntro", intro)
    runtimeShader.setFloatUniform("uOpacity", opacity)
    setOrigin(runtimeShader, nextTarget, originScreenX, originScreenY)

    // RenderEffect snapshots shader uniforms, so the wrapper must be refreshed after each update.
    nextTarget.setRenderEffect(RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents"))
    effectApplied = true
    nextTarget.invalidate()
  }

  fun clear() {
    if (effectApplied) target?.setRenderEffect(null)
    target?.invalidate()
    target = null
    shader = null
    effectApplied = false
  }

  private fun setOrigin(
    runtimeShader: RuntimeShader,
    view: View,
    screenX: Float?,
    screenY: Float?,
  ) {
    if (screenX == null || screenY == null) {
      runtimeShader.setFloatUniform("uWaveOrigin", 0.5f, 1f)
      return
    }
    view.getLocationOnScreen(location)
    runtimeShader.setFloatUniform(
      "uWaveOrigin",
      ((screenX - location[0]) / view.width).coerceIn(0f, 1f),
      ((screenY - location[1]) / view.height).coerceIn(0f, 1f),
    )
  }

  private companion object {
    // Reacticx Skia Ripple, MIT, rit3zh, commit 40a91c79d6aa44e2defed9a6a2886b9e0ded5ecd.
    private const val SHADER_SOURCE = """
      uniform shader contents;
      uniform float2 iResolution;
      uniform float uDensity;
      uniform float uIntro;
      uniform float uOpacity;
      uniform float2 uWaveOrigin;

      half4 main(float2 fragCoord) {
        float2 origin = uWaveOrigin * iResolution;
        float2 fromOrigin = fragCoord - origin;
        float distanceFromOrigin = length(fromOrigin);
        float reach = max(1.0, length(max(origin, iResolution - origin)));
        float duration = reach / (1200.0 * uDensity) + 1.2;
        float front = uIntro * duration - distanceFromOrigin / (1200.0 * uDensity);
        float time = max(0.0, front);
        float rippleAmount = 12.0 * sin(15.0 * time) * exp(-8.0 * time);
        float2 direction = distanceFromOrigin > 0.001 * uDensity
          ? fromOrigin / distanceFromOrigin : float2(0.0, 0.0);
        float2 samplePoint = fragCoord + rippleAmount * uDensity * direction;
        half4 foreground = contents.eval(clamp(samplePoint, float2(0.0), iResolution));
        float brightness = 0.3 * (rippleAmount / 12.0) * foreground.a;
        foreground.rgb += half(brightness);
        return mix(contents.eval(fragCoord), foreground, half(uOpacity));
      }
    """
  }
}

private class VoiceAuraOverlayView(context: android.content.Context) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var auraShader: RuntimeShader? = null

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    setBackgroundColor(Color.TRANSPARENT)
    setWillNotDraw(false)
  }

  fun setAuraShader(shader: RuntimeShader) {
    auraShader = shader
    paint.shader = shader
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.TRANSPARENT, BlendMode.CLEAR)
    if (auraShader == null) return
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
  }

  override fun isOpaque(): Boolean = false
}
