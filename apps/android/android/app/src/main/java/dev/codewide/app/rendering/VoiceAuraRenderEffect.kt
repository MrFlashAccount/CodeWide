package dev.codewide.app.rendering

import android.R
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.view.Choreographer
import android.view.View
import android.view.animation.PathInterpolator
import com.facebook.react.bridge.ReactApplicationContext
import java.lang.ref.WeakReference
import kotlin.math.exp
import kotlin.math.log10

/**
 * Applies the Reacticx Apple Intelligence shader to the live React root RenderNode.
 *
 * Unlike Reacticx's one-time captured snapshot, Android binds the current
 * View hierarchy to the shader's `contents` uniform on every GPU frame. The shader
 * body below is otherwise the upstream implementation from Reacticx 1.21.0,
 * commit 369f0ebfa55f7ec690307b1bbcd4c648c2777fc1 (MIT).
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
  private var targetLevel = 0f
  private var smoothedLevel = 0f
  private var intensity = 0f
  private var transitionFrom = 0f
  private var transitionTo = 0f
  private var transitionStartedAt = 0L
  private var transitionDurationNanos = 0L
  private var lastFrameNanos = 0L
  private var elapsedSeconds = 0f

  fun setTarget(view: View?) {
    check(android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
      "Voice aura target must be updated on the UI thread"
    }
    val currentTarget = requestedRootView?.get()
    if (currentTarget === view) return
    requestedRootView = view?.let(::WeakReference)
    if (rootView !== null && rootView !== view) detach()
    if (requestedActive || intensity > 0f) {
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
    targetLevel = if (active) normalizeLevel(rawLevel) else 0f

    if (active && stateChanged) {
      elapsedSeconds = 0f
      lastFrameNanos = 0L
      smoothedLevel = 0f
    }

    if (stateChanged) {
      transitionFrom = intensity
      transitionTo = if (active) 1f else 0f
      transitionStartedAt = 0L
      transitionDurationNanos = if (reduceMotion) 0L else if (active) INTRO_DURATION_NANOS else OUTRO_DURATION_NANOS
    }

    if (active || intensity > 0f) {
      ensureRootView()
      postFrame()
    } else {
      detach()
    }
  }

  fun clear() {
    requestedActive = false
    targetLevel = 0f
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

    updateIntensity(frameTimeNanos)
    if (!reducedMotion && (requestedActive || intensity > 0f)) elapsedSeconds += deltaSeconds
    smoothedLevel = if (reducedMotion) {
      targetLevel
    } else {
      val responseSeconds = if (targetLevel > smoothedLevel) LEVEL_ATTACK_SECONDS else LEVEL_RELEASE_SECONDS
      val response = (1.0 - exp((-deltaSeconds / responseSeconds).toDouble())).toFloat()
      smoothedLevel + (targetLevel - smoothedLevel) * response
    }

    draw(view)
    if (requestedActive || intensity > 0f) {
      postFrame()
    } else {
      detach()
    }
  }

  private fun updateIntensity(frameTimeNanos: Long) {
    if (transitionDurationNanos == 0L) {
      intensity = transitionTo
      return
    }
    if (transitionStartedAt == 0L) transitionStartedAt = frameTimeNanos
    val progress = ((frameTimeNanos - transitionStartedAt).toDouble() / transitionDurationNanos.toDouble())
      .coerceIn(0.0, 1.0)
      .toFloat()
    val eased = if (transitionTo > transitionFrom) {
      INTRO_INTERPOLATOR.getInterpolation(progress)
    } else {
      1f - (1f - progress) * (1f - progress)
    }
    intensity = transitionFrom + (transitionTo - transitionFrom) * eased
    if (progress >= 1f) intensity = transitionTo
  }

  private fun draw(view: View) {
    if (view.width <= 0 || view.height <= 0) return
    val runtimeShader = shader ?: RuntimeShader(SHADER_SOURCE).also { shader = it }
    val density = view.resources.displayMetrics.density

    runtimeShader.setFloatUniform("iTime", elapsedSeconds)
    runtimeShader.setFloatUniform("intensity", intensity)
    runtimeShader.setFloatUniform("iResolution", view.width.toFloat(), view.height.toFloat())
    runtimeShader.setFloatUniform("uMargin", 6f * density)
    // The demo uses 20 pt. Sixteen keeps the aura slightly narrower; the
    // normalized microphone envelope only breathes this one uniform up to 20.
    runtimeShader.setFloatUniform("uExcess", (16f + 4f * smoothedLevel) * density)
    runtimeShader.setFloatUniform("uRadius", 48f * density)
    runtimeShader.setFloatUniform("uWaveSpeed", 10f)
    runtimeShader.setFloatUniform("uWaveStrength", 1f)
    runtimeShader.setFloatUniform("uWaveOrigin", 0.5f, 1f)
    runtimeShader.setFloatUniform("uNoiseScale", 2f)
    runtimeShader.setFloatUniform("uNoiseSpeed", 4f)
    runtimeShader.setFloatUniform("uNoiseStrength", 0.6f)
    runtimeShader.setFloatUniform("uGlowSpeed", 0.2f)
    runtimeShader.setFloatUniform("uGlowSaturation", 0.85f)
    runtimeShader.setFloatUniform("uGlowLightness", 0.6f)
    runtimeShader.setFloatUniform("uShimmerAmount", 0.3f)
    runtimeShader.setFloatUniform("uShimmerSpeed", 2.5f)
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

  private fun ensureRootView(): View? {
    val activity = context.currentActivity ?: return rootView
    val requestedRoot = requestedRootView?.get()?.takeIf(View::isAttachedToWindow)
    val nextRoot = requestedRoot ?: activity.findViewById<View>(R.id.content) ?: activity.window.decorView
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

  private fun normalizeLevel(rawLevel: Double): Float {
    val decibels = 20.0 * log10(rawLevel.coerceAtLeast(0.0001))
    val normalized = ((decibels - LEVEL_FLOOR_DB) / (LEVEL_CEILING_DB - LEVEL_FLOOR_DB))
      .coerceIn(0.0, 1.0)
      .toFloat()
    return normalized * normalized * (3f - 2f * normalized)
  }

  private companion object {
    private const val INTRO_DURATION_NANOS = 1_200_000_000L
    private const val OUTRO_DURATION_NANOS = 280_000_000L
    private const val MAX_FRAME_DELTA_NANOS = 66_666_667L
    private const val LEVEL_ATTACK_SECONDS = 0.09f
    private const val LEVEL_RELEASE_SECONDS = 0.22f
    private const val LEVEL_FLOOR_DB = -48.0
    private const val LEVEL_CEILING_DB = -16.0
    private val INTRO_INTERPOLATOR = PathInterpolator(0.25f, 0.1f, 0.25f, 1f)

    // Reacticx 1.21.0 Apple Intelligence shader, MIT, Copyright (c) 2026 rit3zh.
    private const val SHADER_SOURCE = """
      uniform float iTime;
      uniform float intensity;
      uniform float2 iResolution;
      uniform shader contents;
      uniform float uMargin;
      uniform float uExcess;
      uniform float uRadius;
      uniform float uWaveSpeed;
      uniform float uWaveStrength;
      uniform float2 uWaveOrigin;
      uniform float uNoiseScale;
      uniform float uNoiseSpeed;
      uniform float uNoiseStrength;
      uniform float uGlowSpeed;
      uniform float uGlowSaturation;
      uniform float uGlowLightness;
      uniform float uShimmerAmount;
      uniform float uShimmerSpeed;
      uniform int uColorCount;
      uniform float3 uColor0;
      uniform float3 uColor1;
      uniform float3 uColor2;
      uniform float3 uColor3;
      uniform float3 uColor4;
      uniform float3 uColor5;
      uniform float3 uColor6;
      uniform float3 uColor7;

      float3 hash33(float3 p3) {
        p3 = fract(p3 * float3(0.1031, 0.11369, 0.13787));
        p3 += dot(p3, p3.yxz + 19.19);
        return -1.0 + 2.0 * fract(float3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
      }

      float snoise3(float3 p) {
        const float K1 = 0.333333333;
        const float K2 = 0.166666667;
        float3 i = floor(p + (p.x + p.y + p.z) * K1);
        float3 d0 = p - (i - (i.x + i.y + i.z) * K2);
        float3 e = step(float3(0.0), d0 - d0.yzx);
        float3 i1 = e * (1.0 - e.zxy);
        float3 i2 = 1.0 - e.zxy * (1.0 - e);
        float3 d1 = d0 - (i1 - K2);
        float3 d2 = d0 - (i2 - K1);
        float3 d3 = d0 - 0.5;
        float4 h = max(0.6 - float4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
        float4 n = h * h * h * h * float4(
          dot(d0, hash33(i)), dot(d1, hash33(i + i1)),
          dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
        return dot(float4(31.316), n);
      }

      float circle(float2 st, float2 center, float radius) {
        float2 dist = st - center;
        float dd = dot(dist, dist) * 4.0;
        return smoothstep(radius - radius * 0.5, radius, dd);
      }

      float3 hsl2rgb(float h, float s, float l) {
        float3 rgb = clamp(abs(mod(h * 6.0 + float3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
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
        float2 uv = fragCoord / iResolution;
        float range = intensity;
        float2 margin = uMargin / iResolution;
        float2 excess = uExcess / iResolution;
        float2 radius = uRadius / iResolution;
        float2 point = abs(uv - 0.5);
        float2 corner = 0.5 - margin - radius - excess;
        float2 offset = max(point - corner, 0.0);
        float dist = length(offset / radius) - 1.0;
        float2 st = uv;
        float r = uWaveSpeed * range;
        float c1 = circle(st, uWaveOrigin, r);
        float wpct = 1.0 - (c1 * (1.0 - c1));
        float3 cc = pow(mix(float3(1.069, 1.077, 1.100), float3(1.0), wpct), float3(8.0));
        float wS = st.y * uWaveStrength * range * (wpct - st.y);
        st.y += wS * (1.0 - range);
        half4 foreground = contents.eval(st * iResolution);
        float vol = 0.35 + 0.15 * sin(iTime * 2.0);
        float noise = max(0.0, snoise3(float3(uv * uNoiseScale, iTime / uNoiseSpeed)) * (vol * uNoiseStrength));
        float alpha = smoothstep(uMargin / uRadius, (uMargin + uExcess) / uRadius, dist + noise);
        float angle = atan(uv.y - 0.5, uv.x - 0.5);
        float t = fract((angle / 6.2832) + iTime * uGlowSpeed);
        float3 glow;
        if (uColorCount > 0) {
          glow = sampleGradient(t);
        } else {
          glow = hsl2rgb(t, uGlowSaturation, uGlowLightness);
        }
        float shimmer = 0.5 + 0.5 * sin(angle * 3.0 + iTime * uShimmerSpeed);
        glow = mix(glow, glow * 1.4, shimmer * uShimmerAmount);
        half4 background = half4(half3(glow), 1.0);
        float edge = alpha * (1.0 - c1);
        float bgMask = 1.0 - (1.0 - edge) * (1.0 - (1.0 - c1) * (1.0 - range) * 0.5);
        half4 color = mix(foreground, background, half4(bgMask * intensity));
        color *= half4(half3(cc), 1.0);
        return color;
      }
    """
  }
}
