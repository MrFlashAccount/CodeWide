package dev.codewide.app.rendering

import android.R
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.view.Choreographer
import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import java.lang.ref.WeakReference

/**
 * Live-content distortion plus perimeter-only speech glow. The intro starts at
 * the pressed microphone; microphone energy never traverses the React render loop.
 * Originally based on Reacticx 1.21.0 (MIT), now using perimeter geometry.
 */
class VoiceAuraRenderEffect(
  private val context: ReactApplicationContext,
) : Choreographer.FrameCallback {
  private var shader: RuntimeShader? = null
  private var rootView: View? = null
  private var requestedRootView: WeakReference<View>? = null
  private var effectApplied = false
  private var framePosted = false
  private var requestedActive = false
  private var reducedMotion = false
  private val envelope = VoiceAuraEnvelope()
  private var originX = 0.5f
  private var originY = 1f
  private val location = IntArray(2)
  private var intensity = 0f
  private val transition = VoiceAuraTransition()
  private var lastFrameNanos = 0L
  private var elapsedSeconds = 0f

  /** Capture screen coordinates once; retain a relative origin across resizing/folding. */
  fun setOrigin(source: View?) {
    val target = resolveRootView()
    if (source == null || target == null || target.width <= 0 || target.height <= 0) {
      originX = 0.5f
      originY = 1f
      return
    }
    source.getLocationOnScreen(location)
    val centerX = location[0] + source.width / 2f
    val centerY = location[1] + source.height / 2f
    target.getLocationOnScreen(location)
    originX = ((centerX - location[0]) / target.width).coerceIn(0f, 1f)
    originY = ((centerY - location[1]) / target.height).coerceIn(0f, 1f)
  }

  /** Level updates do not start/stop the effect or reset its intro. */
  fun setLevel(rawLevel: Double) {
    envelope.accept(rawLevel)
  }

  fun setTarget(view: View?) {
    check(android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
      "Voice aura target must be updated on the UI thread"
    }
    val currentTarget = requestedRootView?.get()
    if (currentTarget === view) return
    requestedRootView = view?.let(::WeakReference)
    if (rootView !== null && rootView !== view) detach()
    if (transition.isVisible) {
      ensureRootView()
      postFrame()
    }
  }

  fun update(active: Boolean, rawLevel: Double, reduceMotion: Boolean) {
    check(android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
      "Voice aura must be updated on the UI thread"
    }
    val stateChanged = active != requestedActive
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
      ensureRootView()
      postFrame()
    } else {
      detach()
    }
  }

  fun clear() {
    requestedActive = false
    envelope.reset()
    transition.reset()
    intensity = 0f
    if (framePosted) {
      Choreographer.getInstance().removeFrameCallback(this)
      framePosted = false
    }
    detach()
  }

  override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    val view = ensureRootView() ?: return
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

    draw(view)
    if (transition.isVisible) {
      postFrame()
    } else {
      detach()
    }
  }

  private fun draw(view: View) {
    if (view.width <= 0 || view.height <= 0) return
    val runtimeShader = shader ?: RuntimeShader(SHADER_SOURCE).also { shader = it }
    val density = view.resources.displayMetrics.density

    runtimeShader.setFloatUniform("iTime", elapsedSeconds)
    runtimeShader.setFloatUniform("intensity", intensity)
    runtimeShader.setFloatUniform("iResolution", view.width.toFloat(), view.height.toFloat())
    runtimeShader.setFloatUniform("uDensity", density)
    runtimeShader.setFloatUniform("uLevel", if (reducedMotion) 0f else envelope.value)
    runtimeShader.setFloatUniform("uIntro", intensity)
    runtimeShader.setFloatUniform("uOpacity", transition.opacity)
    runtimeShader.setFloatUniform("uMotion", if (reducedMotion) 0f else 1f)
    runtimeShader.setFloatUniform("uRadius", 48f * density)
    runtimeShader.setFloatUniform("uWaveOrigin", originX, originY)
    runtimeShader.setIntUniform("uColorCount", 5)
    runtimeShader.setFloatUniform("uColor0", 1f, 107f / 255f, 157f / 255f)
    runtimeShader.setFloatUniform("uColor1", 196f / 255f, 74f / 255f, 1f)
    runtimeShader.setFloatUniform("uColor2", 88f / 255f, 86f / 255f, 214f / 255f)
    runtimeShader.setFloatUniform("uColor3", 0f, 201f / 255f, 1f)
    runtimeShader.setFloatUniform("uColor4", 1f, 107f / 255f, 157f / 255f)
    runtimeShader.setFloatUniform("uColor5", 0f, 0f, 0f)
    runtimeShader.setFloatUniform("uColor6", 0f, 0f, 0f)
    runtimeShader.setFloatUniform("uColor7", 0f, 0f, 0f)

    // RenderEffect snapshots RuntimeShader uniforms when it is created. Reusing
    // the first effect freezes intensity/time at their initial values, so create
    // the lightweight effect wrapper again after updating uniforms each frame.
    view.setRenderEffect(RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents"))
    effectApplied = true
    view.invalidate()
  }

  private fun resolveRootView(): View? {
    val activity = context.currentActivity ?: return rootView
    val requestedRoot = requestedRootView?.get()?.takeIf(View::isAttachedToWindow)
    return requestedRoot ?: activity.findViewById<View>(R.id.content) ?: activity.window.decorView
  }

  private fun ensureRootView(): View? {
    val nextRoot = resolveRootView() ?: return null
    if (rootView === nextRoot) return nextRoot
    detach()
    rootView = nextRoot
    return nextRoot
  }

  private fun detach() {
    if (effectApplied) rootView?.setRenderEffect(null)
    rootView?.invalidate()
    rootView = null
    effectApplied = false
    shader = null
    lastFrameNanos = 0L
  }

  private fun postFrame() {
    if (framePosted) return
    framePosted = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  private companion object {
    private const val MAX_FRAME_DELTA_NANOS = 66_666_667L

    // Adapted from Reacticx 1.21.0, MIT, Copyright (c) 2026 rit3zh.
    private const val SHADER_SOURCE = """
      uniform float iTime;
      uniform float intensity;
      uniform float2 iResolution;
      uniform shader contents;
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

      // Arc length around the nearest rounded-rectangle edge, clockwise from
      // the top-left tangent. Angles are local to corners, never screen-centered.
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
        float2 fromOrigin = fragCoord - origin;
        float distanceFromOrigin = length(fromOrigin);
        float reach = max(1.0, length(max(origin, iResolution - origin)));
        // This is the spatial phase span, not wall-clock duration. The native
        // Bezier clock traverses it in fixed time on every screen size.
        float duration = reach / (1200.0 * uDensity) + 1.2;
        float front = uIntro * duration - distanceFromOrigin / (1200.0 * uDensity);
        float reveal = smoothstep(0.0, 0.08, front);
        float phase = position / perimeter;
        float drift = 0.65 * sin(phase * 12.56637 - iTime * 0.6)
          + 0.35 * sin(phase * 18.84956 + iTime * 0.4);
        float width = (10.0 + 18.0 * uLevel + 1.5 * drift) * uDensity;
        float edgeGlow = exp(-inset * inset / (width * width));
        // Exact zero outside the edge band prevents any central tint or spokes.
        edgeGlow *= 1.0 - smoothstep(width * 2.0, width * 3.0, inset);
        float3 glow = sampleGradient(phase + iTime * 0.035 + 0.025 * drift);

        // Reacticx Skia Ripple, MIT, rit3zh, commit
        // 40a91c79d6aa44e2defed9a6a2886b9e0ded5ecd:
        // Preserve amplitude, damped sine, spatial delay and brightness exactly.
        // No recording age participates, so even a long capture reverses.
        float time = max(0.0, front);
        float rippleAmount = 12.0 * sin(15.0 * time) * exp(-8.0 * time) * uMotion;
        float2 direction = distanceFromOrigin > 0.001 * uDensity
          ? fromOrigin / distanceFromOrigin : float2(0.0, 0.0);
        float2 samplePoint = fragCoord + rippleAmount * uDensity * direction;
        half4 foreground = contents.eval(clamp(samplePoint, float2(0.0), iResolution));
        float brightness = 0.3 * (rippleAmount / 12.0) * foreground.a;
        foreground.rgb += half(brightness);

        // A small initial halo anchors the effect to the actual pressed button.
        float haloRadius = (18.0 + 18.0 * smoothstep(0.0, 0.25, uIntro)) * uDensity;
        float haloBand = (distanceFromOrigin - haloRadius) / (8.0 * uDensity);
        float halo = exp(-haloBand * haloBand) * (1.0 - smoothstep(0.1, 0.35, uIntro));
        float alpha = intensity * clamp(edgeGlow * reveal * (0.55 + 0.4 * uLevel) + halo * 0.55, 0.0, 1.0);
        // Preserve the live content alpha; no opaque background or full-screen tint.
        half4 original = contents.eval(fragCoord);
        half4 effect = half4(mix(foreground.rgb, half3(glow) * foreground.a, half(alpha)), foreground.a);
        return mix(original, effect, half(uOpacity));
      }
    """
  }
}
