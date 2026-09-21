package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

internal data class ParticlesOrbPoint(
  val x: Float,
  val y: Float,
  val z: Float,
  val ringFrac: Float,
  val seed: Float,
  val tone: Float,
)

internal data class ParticlesOrbWeights(
  val idle: Float,
  val connecting: Float,
  val listening: Float,
  val thinking: Float,
  val speaking: Float,
  val error: Float,
  val disabled: Float,
) {
  fun forState(state: VoiceAssistantOrbState): Float = when (state) {
    VoiceAssistantOrbState.IDLE -> idle
    VoiceAssistantOrbState.CONNECTING -> connecting
    VoiceAssistantOrbState.LISTENING -> listening
    VoiceAssistantOrbState.THINKING -> thinking
    VoiceAssistantOrbState.SPEAKING -> speaking
    VoiceAssistantOrbState.ERROR -> error
    VoiceAssistantOrbState.DISABLED -> disabled
  }

  val total: Float
    get() = idle + connecting + listening + thinking + speaking + error + disabled
}

internal data class ParticlesOrbFrame(
  val time: Float,
  val angleY: Float,
  val connectingPhase: Float,
  val level: Float,
  val weights: ParticlesOrbWeights,
  val ripple: Float,
  val pulse: Float,
  val flow: Float,
  val motionScale: Float,
  val radiusScale: Float,
  val additiveGlow: Boolean,
  val isStatic: Boolean,
)

internal data class ParticlesOrbProjection(
  val x: Float,
  val y: Float,
  val alpha: Float,
  val dotRadius: Float,
  val color: Int,
)

internal class MutableParticlesOrbProjection {
  var x = 0f
  var y = 0f
  var alpha = 0f
  var dotRadius = 0f
  var color = 0
}

/** Exact state mixing and particle geometry from VoiceOrbs' MIT Particles Orb. */
internal object ParticlesOrbModel {
  const val PARTICLE_COUNT = 192
  const val STATIC_TIME_SECONDS = 1.7f
  const val ANGLE_X = 0.32f
  const val TWO_PI = (PI * 2.0).toFloat()
  private const val GOLDEN_ANGLE = PI * (3.0 - 2.23606797749979)

  fun buildSphere(): List<ParticlesOrbPoint> = List(PARTICLE_COUNT) { index ->
    val y = 1f - (index.toFloat() / (PARTICLE_COUNT - 1)) * 2f
    val radiusAtY = sqrt(1f - y * y)
    val theta = (GOLDEN_ANGLE * index).toFloat()
    ParticlesOrbPoint(
      x = cos(theta) * radiusAtY,
      y = y,
      z = sin(theta) * radiusAtY,
      ringFrac = ((index * 0.61803398875) % 1.0).toFloat(),
      seed = (((index * 0.7548776662) % 1.0) * TWO_PI).toFloat(),
      tone = ((index * 0.5436890126) % 1.0).toFloat(),
    )
  }

  fun approach(current: Float, target: Float, rate: Float, deltaSeconds: Float): Float =
    current + (target - current) * (1f - exp(-rate * deltaSeconds))

  fun stateEnergy(state: VoiceAssistantOrbState, time: Float): Float = when (state) {
    VoiceAssistantOrbState.LISTENING ->
      0.4f + 0.32f * abs(sin(time * 8.5f)) + 0.18f * abs(sin(time * 4.1f + 1.5f))
    VoiceAssistantOrbState.SPEAKING ->
      0.3f + 0.24f * abs(sin(time * 6.2f)) +
        0.16f * abs(sin(time * 3f + 0.6f))
    VoiceAssistantOrbState.THINKING -> 0.24f + 0.2f * abs(sin(time * 2.4f))
    VoiceAssistantOrbState.CONNECTING -> 0.12f + 0.1f * abs(sin(time * 1.6f))
    VoiceAssistantOrbState.ERROR -> 0.2f
    VoiceAssistantOrbState.IDLE,
    VoiceAssistantOrbState.DISABLED,
    -> 0f
  }

  fun project(
    point: ParticlesOrbPoint,
    index: Int,
    frame: ParticlesOrbFrame,
    size: Float,
    density: Float,
  ): ParticlesOrbProjection {
    val output = MutableParticlesOrbProjection()
    projectInto(point, index, frame, size, density, output)
    return ParticlesOrbProjection(output.x, output.y, output.alpha, output.dotRadius, output.color)
  }

  fun projectInto(
    point: ParticlesOrbPoint,
    index: Int,
    frame: ParticlesOrbFrame,
    size: Float,
    density: Float,
    output: MutableParticlesOrbProjection,
  ) {
    val center = size / 2f
    val baseRadius = center * 0.62f
    val radius = baseRadius * frame.radiusScale
    val weights = frame.weights

    val cosY = cos(frame.angleY)
    val sinY = sin(frame.angleY)
    val cosX = cos(ANGLE_X)
    val sinX = sin(ANGLE_X)
    val x1 = point.x * cosY - point.z * sinY
    val z1 = point.x * sinY + point.z * cosY
    val y1 = point.y * cosX - z1 * sinX
    val z2 = point.y * sinX + z1 * cosX
    val depth = (z2 + 1f) / 2f
    val perspective = 0.65f + depth * 0.45f

    val rippleAmp = frame.ripple * (0.045f + frame.level * 0.24f)
    val pulseAmp = frame.pulse * 0.16f
    var pointRadius = radius
    if (rippleAmp > 0.002f) {
      pointRadius *= 1f + rippleAmp * sin(point.y * 4.5f - frame.time * 6.5f)
    }
    if (pulseAmp > 0.002f) {
      pointRadius *= 1f - pulseAmp *
        (0.5f + 0.5f * sin(point.ringFrac * TWO_PI + frame.time * 3.1f))
    }

    val shakeAmp = weights.error * radius * 0.05f * frame.motionScale
    var offsetX = shakeAmp *
      (sin(frame.time * 26f) + 0.5f * sin(frame.time * 15.7f))
    var offsetY = shakeAmp *
      (cos(frame.time * 22.5f) + 0.5f * sin(frame.time * 13.1f))
    val idleAmp = weights.idle * radius * 0.055f * frame.motionScale
    if (idleAmp > 0.01f) {
      offsetX += idleAmp *
        (sin(frame.time * 0.55f + point.seed * 3.7f) +
          0.5f * sin(frame.time * 1.3f + point.seed * 1.3f))
      offsetY += idleAmp *
        (cos(frame.time * 0.62f + point.seed * 2.9f) +
          0.5f * sin(frame.time * 1.05f + point.seed * 5.1f))
    }
    val jitterAmp = (frame.flow + weights.error * 0.7f) * radius *
      (0.015f + frame.level * 0.085f) * frame.motionScale
    if (jitterAmp > 0.01f) {
      offsetX += jitterAmp * sin(frame.time * 14f + point.seed * 9.3f)
      offsetY += jitterAmp * cos(frame.time * 17f + point.seed * 6.1f)
    }

    val sphereX = center + x1 * pointRadius * perspective + offsetX
    val sphereY = center + y1 * pointRadius * perspective + offsetY
    val alphaScale = 1f - weights.disabled * 0.35f
    val disabledOpacity = 1f - weights.disabled * 0.5f
    val sphereAlpha = (0.12f + depth * depth * 0.78f) * alphaScale * disabledOpacity
    val sphereDot = 0.6f + depth * 1.5f

    var screenX = sphereX
    var screenY = sphereY
    var alpha = sphereAlpha
    var dot = sphereDot
    if (weights.connecting > 0.004f) {
      val base = (index.toFloat() / PARTICLE_COUNT) * TWO_PI
      val jitter = 0.05f * sin(frame.time * 1.3f + point.seed)
      val ringAngle = base + frame.connectingPhase + jitter
      val ringRadius = center * (0.58f + 0.13f * point.ringFrac) *
        (1f + 0.05f * sin(frame.time + point.seed * 1.7f))
      val circleX = center + cos(ringAngle) * ringRadius
      val circleY = center + sin(ringAngle) * ringRadius
      val ringAlpha = (0.35f + point.tone * 0.5f) * disabledOpacity
      val ringDot = 0.75f + point.tone * 0.9f
      screenX += (circleX - sphereX) * weights.connecting
      screenY += (circleY - sphereY) * weights.connecting
      alpha += (ringAlpha - sphereAlpha) * weights.connecting
      dot += (ringDot - sphereDot) * weights.connecting
    }

    val fromRed = 240f + (251f - 240f) * weights.error
    val fromGreen = 171f + (113f - 171f) * weights.error
    val fromBlue = 252f + (133f - 252f) * weights.error
    val toRed = 129f + (244f - 129f) * weights.error
    val toGreen = 140f + (63f - 140f) * weights.error
    val toBlue = 248f + (94f - 248f) * weights.error
    output.x = screenX
    output.y = screenY
    output.alpha = alpha
    output.dotRadius = dot * density
    val baseRed = fromRed + (toRed - fromRed) * point.tone
    val baseGreen = fromGreen + (toGreen - fromGreen) * point.tone
    val baseBlue = fromBlue + (toBlue - fromBlue) * point.tone
    val grayscale = baseRed * 0.2126f + baseGreen * 0.7152f + baseBlue * 0.0722f
    val grayscaleAmount = weights.disabled * 0.85f
    val red = (baseRed + (grayscale - baseRed) * grayscaleAmount).toInt()
    val green = (baseGreen + (grayscale - baseGreen) * grayscaleAmount).toInt()
    val blue = (baseBlue + (grayscale - baseBlue) * grayscaleAmount).toInt()
    output.color = (0xff shl 24) or (red shl 16) or (green shl 8) or blue
  }
}

internal class ParticlesOrbStateMix(initial: VoiceAssistantOrbState = VoiceAssistantOrbState.IDLE) {
  private val weights = FloatArray(VoiceAssistantOrbState.entries.size).also { values ->
    values[initial.ordinal] = 1f
  }

  fun update(state: VoiceAssistantOrbState, deltaSeconds: Float, rate: Float = 6f): ParticlesOrbWeights {
    var total = 0f
    for (key in VoiceAssistantOrbState.entries) {
      val target = if (key == state) 1f else 0f
      val approached = ParticlesOrbModel.approach(weights[key.ordinal], target, rate, deltaSeconds)
      val next = if (target == 0f && approached < 0.001f) 0f else approached
      weights[key.ordinal] = next
      total += next
    }
    if (total > 0f) {
      for (index in weights.indices) weights[index] /= total
    }
    return snapshot()
  }

  fun snapshot(): ParticlesOrbWeights = ParticlesOrbWeights(
    idle = weights[VoiceAssistantOrbState.IDLE.ordinal],
    connecting = weights[VoiceAssistantOrbState.CONNECTING.ordinal],
    listening = weights[VoiceAssistantOrbState.LISTENING.ordinal],
    thinking = weights[VoiceAssistantOrbState.THINKING.ordinal],
    speaking = weights[VoiceAssistantOrbState.SPEAKING.ordinal],
    error = weights[VoiceAssistantOrbState.ERROR.ordinal],
    disabled = weights[VoiceAssistantOrbState.DISABLED.ordinal],
  )
}

/** One clock-owned simulation for both production rendering and deterministic frame tests. */
internal class ParticlesOrbSimulation(initialState: VoiceAssistantOrbState = VoiceAssistantOrbState.IDLE) {
  private val stateMix = ParticlesOrbStateMix(initialState)
  private var time = 0f
  private var angleY = 0f
  private var connectingPhase = 0f
  private var sourceLevelSmoothed = 0f
  private var levelSmoothed = 0f

  fun advance(
    state: VoiceAssistantOrbState,
    inputLevel: Float?,
    playbackLevel: Float?,
    deltaSeconds: Float,
    isStatic: Boolean = false,
  ): ParticlesOrbFrame {
    if (isStatic) time = ParticlesOrbModel.STATIC_TIME_SECONDS else time += deltaSeconds
    val easeDelta = if (isStatic) 60f else deltaSeconds
    val weights = stateMix.update(state, easeDelta)
    val targetLevel = when {
      isStatic -> ParticlesOrbModel.stateEnergy(state, time)
      state == VoiceAssistantOrbState.LISTENING -> inputLevel?.coerceIn(0f, 1f) ?: 0f
      state == VoiceAssistantOrbState.SPEAKING -> playbackLevel?.coerceIn(0f, 1f) ?: 0f
      else -> ParticlesOrbModel.stateEnergy(state, time)
    }
    val envelopeRate = if (targetLevel > sourceLevelSmoothed) 14f else 4f
    sourceLevelSmoothed = ParticlesOrbModel.approach(
      sourceLevelSmoothed,
      targetLevel,
      envelopeRate,
      easeDelta,
    )
    levelSmoothed = ParticlesOrbModel.approach(levelSmoothed, sourceLevelSmoothed, 9f, easeDelta)

    val ripple = weights.listening
    val pulse = weights.thinking
    val flow = weights.speaking
    val motionScale = 1f - weights.disabled * 0.96f
    val spin = (0.14f + ripple * (0.9f + levelSmoothed * 1.6f) + flow * 0.4f +
      weights.connecting * 0.3f) * motionScale
    angleY += deltaSeconds * spin
    connectingPhase = (connectingPhase + deltaSeconds * 1.1f) % ParticlesOrbModel.TWO_PI
    val breathe = 0.05f * (0.25f + weights.idle * 0.75f) * sin(time * 1.1f) * motionScale
    val convergence = pulse * (0.22f + 0.12f * sin(time * 2.6f + 1f))
    val expansion = flow * (0.08f + levelSmoothed * 0.32f)

    return ParticlesOrbFrame(
      time = time,
      angleY = angleY,
      connectingPhase = connectingPhase,
      level = levelSmoothed,
      weights = weights,
      ripple = ripple,
      pulse = pulse,
      flow = flow,
      motionScale = motionScale,
      radiusScale = 1f + breathe + levelSmoothed * 0.16f + expansion - convergence,
      additiveGlow = !isStatic && ripple + pulse + flow > 0.5f,
      isStatic = isStatic,
    )
  }
}

/**
 * Native Canvas port of VoiceOrbs' Particles Orb, scaled without changing its motion geometry.
 * Source: amunozdev/voiceorbs@339ab42d98f6c4ffa03709ffa71f9f6965a2171a (MIT).
 */
internal class ParticlesOrbView(context: Context) : VoiceAssistantOrbView(context) {
  private val particlePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val additiveXfermode = PorterDuffXfermode(PorterDuff.Mode.ADD)
  private val points = ParticlesOrbModel.buildSphere()
  private val density = resources.displayMetrics.density
  private var simulation = ParticlesOrbSimulation()
  private val projection = MutableParticlesOrbProjection()
  private var inputLevel: Float? = null
  private var playbackLevel: Float? = null
  private var frame = simulation.advance(orbState, null, null, 0f)
  private var hasAdvanced = false

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  override fun setAudioLevels(inputLevel: Double, playbackLevel: Double) {
    this.inputLevel = inputLevel.normalizedLevel()
    this.playbackLevel = playbackLevel.normalizedLevel()
  }

  override fun advanceAnimation(deltaSeconds: Float) {
    hasAdvanced = true
    frame = simulation.advance(orbState, inputLevel, playbackLevel, deltaSeconds)
  }

  override fun onOrbStateChanged() {
    if (!hasAdvanced) {
      simulation = ParticlesOrbSimulation(orbState)
      frame = simulation.advance(orbState, inputLevel, playbackLevel, 0f)
    }
    if (reducedMotion) frame = simulation.advance(orbState, null, null, 0f, isStatic = true)
  }

  override fun onReducedMotionChanged() {
    frame = if (reducedMotion) {
      simulation.advance(orbState, null, null, 0f, isStatic = true)
    } else {
      simulation.advance(orbState, inputLevel, playbackLevel, 0f)
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0) return
    val size = minOf(width, height).toFloat()
    particlePaint.xfermode = if (frame.additiveGlow) additiveXfermode else null
    for (index in points.indices) {
      ParticlesOrbModel.projectInto(points[index], index, frame, size, density, projection)
      particlePaint.color = projection.color
      particlePaint.alpha = (projection.alpha * 255f).toInt().coerceIn(0, 255)
      canvas.drawCircle(projection.x, projection.y, projection.dotRadius, particlePaint)
    }
    particlePaint.xfermode = null
  }

  private fun Double.normalizedLevel(): Float? =
    if (isFinite() && this >= 0.0) toFloat().coerceIn(0f, 1f) else null
}
