package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RuntimeShader
import kotlin.math.exp

/** Draws the production Reacticx Nebula shader under the shared Voice Assistant state contract. */
class NebulaOrbView(context: Context) : VoiceAssistantOrbView(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val shader = RuntimeShader(SHADER_SOURCE)
  private var elapsedSeconds = 0f
  private val inputEnvelope = NebulaOrbEnvelope()
  private val playbackEnvelope = NebulaOrbEnvelope()

  init {
    paint.shader = shader
    updatePalette()
    shader.setFloatUniform("uScale", 1f)
    shader.setFloatUniform("uContrast", 0.8f)
    shader.setFloatUniform("uEdgeSoftness", 0.01f)
  }

  /** Accepts independent normalized capture and playback energy without another animation clock. */
  override fun setAudioLevels(inputLevel: Double, playbackLevel: Double) {
    inputEnvelope.accept(inputLevel)
    playbackEnvelope.accept(playbackLevel)
  }

  override fun onOrbStateChanged() {
    updatePalette()
  }

  override fun advanceAnimation(deltaSeconds: Float) {
    inputEnvelope.advance(deltaSeconds)
    playbackEnvelope.advance(deltaSeconds)
    elapsedSeconds += deltaSeconds * animationSpeed()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0) return
    shader.setFloatUniform("uResolution", width.toFloat(), height.toFloat())
    shader.setFloatUniform("uTime", elapsedSeconds)
    shader.setFloatUniform("uTurbulence", turbulence())
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
  }

  private fun animationSpeed(): Float = when (orbState) {
    VoiceAssistantOrbState.IDLE -> 0.72f
    VoiceAssistantOrbState.CONNECTING -> 1.35f
    VoiceAssistantOrbState.LISTENING -> 1f + inputEnvelope.value * 1.4f
    VoiceAssistantOrbState.THINKING -> 1.7f
    VoiceAssistantOrbState.SPEAKING -> 1f + playbackEnvelope.value * 1.55f
    VoiceAssistantOrbState.ERROR -> 0f
    VoiceAssistantOrbState.DISABLED -> 0f
  }

  private fun turbulence(): Float = when (orbState) {
    VoiceAssistantOrbState.IDLE -> 1.2f
    VoiceAssistantOrbState.CONNECTING -> 1.5f
    VoiceAssistantOrbState.LISTENING -> 1.2f + inputEnvelope.value * 0.8f
    VoiceAssistantOrbState.THINKING -> 1.85f
    VoiceAssistantOrbState.SPEAKING -> 1.2f + playbackEnvelope.value * 0.9f
    VoiceAssistantOrbState.ERROR -> 0.65f
    VoiceAssistantOrbState.DISABLED -> 0.45f
  }

  private fun updatePalette() {
    if (orbState == VoiceAssistantOrbState.DISABLED) {
      shader.setFloatUniform("uColor", 92f / 255f, 94f / 255f, 99f / 255f)
      shader.setFloatUniform("uHighlight", 174f / 255f, 176f / 255f, 181f / 255f)
      return
    }
    shader.setFloatUniform("uColor", 26f / 255f, 115f / 255f, 242f / 255f)
    shader.setFloatUniform("uHighlight", 252f / 255f, 1f, 1f)
  }

  private companion object {
    // Reacticx Nebula Orb, MIT, Copyright (c) 2026 rit3zh, commit 58479704f1f831913970aa5e78e3691bcb9fa3f7.
    private const val SHADER_SOURCE = """
      uniform float2 uResolution;
      uniform float  uTime;
      uniform float3 uColor;
      uniform float3 uHighlight;
      uniform float  uTurbulence;
      uniform float  uScale;
      uniform float  uContrast;
      uniform float  uEdgeSoftness;

      float hash(float2 p) {
        return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(float2 p) {
        float2 i = floor(p);
        float2 f = fract(p);
        float2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + float2(0.0, 0.0)), hash(i + float2(1.0, 0.0)), u.x),
          mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x),
          u.y);
      }

      float fbm(float2 seed) {
        float2 p = seed;
        float v = 0.0;
        float a = 0.6;
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      half4 main(float2 fragCoord) {
        float2 uv = fragCoord / uResolution;
        float2 guv = float2(uv.x, 1.0 - uv.y);

        float t = uTime * 0.22;
        float2 drift = float2(
          sin(t) + 0.6 * sin(t * 1.7 + 1.3),
          cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1));
        float2 p = float2(guv.x * 1.8, guv.y) * uScale + drift * 0.7;
        float2 q = float2(fbm(p + drift), fbm(p + float2(3.2, 1.5) - drift));
        float f = fbm(p + uTurbulence * q);

        float g = clamp(1.0 - guv.y, 0.0, 1.0);
        float anchor = smoothstep(0.0, 0.3, guv.y);
        float shade = clamp(g + (f - 0.5) * uContrast * anchor, 0.0, 1.0);

        float3 light = mix(uHighlight, uColor, 0.5);
        float3 col = uHighlight;
        col = mix(col, light, smoothstep(0.28, 0.52, shade));
        col = mix(col, uColor, smoothstep(0.58, 0.88, shade));

        float edge = smoothstep(0.5, 0.5 - uEdgeSoftness, distance(uv, float2(0.5)));
        return half4(half3(col) * half(edge), half(edge));
      }
    """
  }
}

/** Attack/release smoothing keeps low-rate WebRTC stats from producing visible stepping. */
internal class NebulaOrbEnvelope {
  private var target = 0f
  var value = 0f
    private set

  fun accept(rawLevel: Double) {
    target = if (rawLevel.isFinite()) rawLevel.toFloat().coerceIn(0f, 1f) else 0f
  }

  fun advance(deltaSeconds: Float) {
    if (deltaSeconds <= 0f) return
    val timeConstant = if (target > value) ATTACK_SECONDS else RELEASE_SECONDS
    val blend = 1f - exp(-deltaSeconds / timeConstant)
    value += (target - value) * blend
  }

  private companion object {
    private const val ATTACK_SECONDS = 0.07f
    private const val RELEASE_SECONDS = 0.3f
  }
}
