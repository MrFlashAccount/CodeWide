package dev.codewide.app.rendering

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParticlesOrbModelTest {
  @Test
  fun selectedOverlayDensityPreservesTheOfficialDeterministicSphereConstruction() {
    val first = ParticlesOrbModel.buildSphere()
    val second = ParticlesOrbModel.buildSphere()

    assertEquals(66, VoiceAssistantOrbView.TARGET_DIAMETER_DP)
    assertEquals(192, ParticlesOrbModel.PARTICLE_COUNT)
    assertEquals(first, second)
    for (point in first) {
      val length = sqrt(point.x * point.x + point.y * point.y + point.z * point.z)
      assertTrue(abs(length - 1f) < 0.0001f)
      assertTrue(point.ringFrac in 0f..1f)
      assertTrue(point.tone in 0f..1f)
    }
    assertEquals(0.61803395f, first[1].ringFrac, 0.000001f)
  }

  @Test
  fun stateWeightsApproachAndNormalizeInsteadOfJumpingEnums() {
    val mix = ParticlesOrbStateMix()
    val first = mix.update(VoiceAssistantOrbState.LISTENING, 1f / 60f)

    assertEquals(1f, first.total, 0.000001f)
    assertTrue(first.idle in 0f..1f)
    assertTrue(first.listening in 0f..1f)
    assertEquals(0.9048374f, first.idle, 0.00001f)
    assertEquals(0.0951626f, first.listening, 0.00001f)

    var settled = first
    repeat(120) {
      settled = mix.update(VoiceAssistantOrbState.LISTENING, 1f / 60f)
    }
    assertEquals(1f, settled.listening, 0.001f)
    assertEquals(0f, settled.idle, 0.001f)
  }

  @Test
  fun everyOfficialStateTransitionKeepsBothEndpointsDuringTheBlend() {
    val states = VoiceAssistantOrbState.entries
    for (index in states.indices) {
      val from = states[index]
      val to = states[(index + 1) % states.size]
      val blended = ParticlesOrbStateMix(from).update(to, 1f / 60f)

      assertEquals(1f, blended.total, 0.000001f)
      assertTrue(blended.forState(from) > 0f)
      assertTrue(blended.forState(from) < 1f)
      assertTrue(blended.forState(to) > 0f)
      assertTrue(blended.forState(to) < 1f)
    }
  }

  @Test
  fun rendererCreatedInAnActiveStateStartsFromThatStateWithoutAnIdleFlash() {
    val frame = ParticlesOrbSimulation(VoiceAssistantOrbState.SPEAKING).advance(
      VoiceAssistantOrbState.SPEAKING,
      inputLevel = null,
      playbackLevel = null,
      deltaSeconds = 0f,
    )

    assertEquals(1f, frame.weights.speaking, 0f)
    assertEquals(0f, frame.weights.idle, 0f)
  }

  @Test
  fun listeningUsesLiveLevelAndLatitudeRipple() {
    val frame = settledFrame(VoiceAssistantOrbState.LISTENING, inputLevel = 0.8f)
    val sameInputWithPlayback = settledFrame(
      VoiceAssistantOrbState.LISTENING,
      inputLevel = 0.8f,
      playbackLevel = 1f,
    )
    val playbackOnly = settledFrame(
      VoiceAssistantOrbState.LISTENING,
      inputLevel = 0f,
      playbackLevel = 1f,
    )
    val point = ParticlesOrbModel.buildSphere()[173]
    val rippled = ParticlesOrbModel.project(point, 173, frame, SIZE, 1f)
    val withoutRipple = ParticlesOrbModel.project(point, 173, frame.copy(ripple = 0f), SIZE, 1f)

    assertEquals(1f, frame.ripple, 0.001f)
    assertEquals(0f, frame.pulse, 0.001f)
    assertEquals(0f, frame.flow, 0.001f)
    assertEquals(0.8f, frame.level, 0.01f)
    assertEquals(frame.level, sameInputWithPlayback.level, 0.000001f)
    assertEquals(0f, playbackOnly.level, 0.01f)
    assertTrue(frame.additiveGlow)
    assertTrue(abs(rippled.x - withoutRipple.x) + abs(rippled.y - withoutRipple.y) > 0.1f)
  }

  @Test
  fun thinkingConvergesInwardWithRingFractionPulse() {
    val frame = settledFrame(VoiceAssistantOrbState.THINKING)
    val base = ParticlesOrbPoint(x = 1f, y = 0f, z = 0f, ringFrac = 0f, seed = 0f, tone = 0f)
    val oppositeRing = base.copy(ringFrac = 0.5f)
    val first = ParticlesOrbModel.project(base, 0, frame, SIZE, 1f)
    val second = ParticlesOrbModel.project(oppositeRing, 0, frame, SIZE, 1f)
    val firstRadius = hypot(first.x - CENTER, first.y - CENTER)
    val secondRadius = hypot(second.x - CENTER, second.y - CENTER)

    assertEquals(1f, frame.pulse, 0.001f)
    assertTrue(frame.radiusScale < 1f)
    assertTrue(abs(firstRadius - secondRadius) > 0.2f)
    assertTrue(frame.additiveGlow)
  }

  @Test
  fun speakingUsesPlaybackLevelAndNeverMicrophoneLevel() {
    val quietPlayback = settledFrame(
      VoiceAssistantOrbState.SPEAKING,
      inputLevel = 1f,
      playbackLevel = 0f,
    )
    val loudPlayback = settledFrame(
      VoiceAssistantOrbState.SPEAKING,
      inputLevel = 0f,
      playbackLevel = 1f,
    )
    val samePlaybackDifferentInput = settledFrame(
      VoiceAssistantOrbState.SPEAKING,
      inputLevel = 1f,
      playbackLevel = 1f,
    )
    val point = ParticlesOrbModel.buildSphere()[121]
    val flowing = ParticlesOrbModel.project(point, 121, loudPlayback, SIZE, 1f)
    val withoutFlow = ParticlesOrbModel.project(point, 121, loudPlayback.copy(flow = 0f), SIZE, 1f)

    assertEquals(0f, quietPlayback.level, 0.01f)
    assertEquals(1f, loudPlayback.level, 0.01f)
    assertEquals(loudPlayback.level, samePlaybackDifferentInput.level, 0.000001f)
    assertEquals(1f, loudPlayback.flow, 0.001f)
    assertTrue(loudPlayback.radiusScale > quietPlayback.radiusScale)
    assertTrue(abs(flowing.x - withoutFlow.x) + abs(flowing.y - withoutFlow.y) > 0.1f)
    assertTrue(loudPlayback.additiveGlow)
  }

  @Test
  fun thinkingIsAutonomousAndIgnoresBothAudioSources() {
    val quiet = settledFrame(VoiceAssistantOrbState.THINKING, inputLevel = 0f, playbackLevel = 0f)
    val loud = settledFrame(VoiceAssistantOrbState.THINKING, inputLevel = 1f, playbackLevel = 1f)

    assertEquals(quiet.level, loud.level, 0.000001f)
    assertEquals(quiet.radiusScale, loud.radiusScale, 0.000001f)
    assertEquals(1f, quiet.pulse, 0.001f)
  }

  @Test
  fun playbackEnvelopeAttacksQuicklyAndDecaysInsteadOfDropping() {
    val simulation = ParticlesOrbSimulation(VoiceAssistantOrbState.SPEAKING)
    val attack = simulation.advance(VoiceAssistantOrbState.SPEAKING, 0f, 1f, 0.07f)
    var release = attack
    repeat(12) {
      release = simulation.advance(VoiceAssistantOrbState.SPEAKING, 0f, 0f, 0.07f)
    }

    assertTrue(attack.level > 0f)
    assertTrue(release.level > 0f)
    assertTrue(release.level < attack.level)
  }

  @Test
  fun connectingMorphsTheSphereIntoTheOfficialRing() {
    val frame = settledFrame(VoiceAssistantOrbState.CONNECTING)
    val point = ParticlesOrbModel.buildSphere()[159]
    val projection = ParticlesOrbModel.project(point, 159, frame, SIZE, 1f)
    val ringRadius = hypot(projection.x - CENTER, projection.y - CENTER)

    assertEquals(1f, frame.weights.connecting, 0.001f)
    assertTrue(ringRadius in 18f..25f)
    assertEquals(0.35f + point.tone * 0.5f, projection.alpha, 0.002f)
    assertEquals(0.75f + point.tone * 0.9f, projection.dotRadius, 0.002f)
    assertTrue(!frame.additiveGlow)
  }

  @Test
  fun disabledRetainsTheOfficialLowMotionAndOpacityContract() {
    val frame = settledFrame(VoiceAssistantOrbState.DISABLED)
    val point = ParticlesOrbModel.buildSphere()[100]
    val disabled = ParticlesOrbModel.project(point, 100, frame, SIZE, 1f)
    val enabled = ParticlesOrbModel.project(
      point,
      100,
      frame.copy(
        weights = frame.weights.copy(disabled = 0f, idle = 1f),
        motionScale = 1f,
      ),
      SIZE,
      1f,
    )

    assertEquals(1f, frame.weights.disabled, 0.001f)
    assertEquals(0.04f, frame.motionScale, 0.001f)
    assertTrue(disabled.alpha < enabled.alpha)
    assertTrue(channelSpread(disabled.color) < channelSpread(enabled.color))
    assertTrue(!frame.additiveGlow)
  }

  @Test
  fun reducedMotionProducesAStaticUpstreamFrameWithoutAdditiveBlend() {
    val frame = ParticlesOrbSimulation().advance(
      VoiceAssistantOrbState.LISTENING,
      inputLevel = 1f,
      playbackLevel = 1f,
      deltaSeconds = 0f,
      isStatic = true,
    )

    assertEquals(ParticlesOrbModel.STATIC_TIME_SECONDS, frame.time, 0f)
    assertEquals(ParticlesOrbModel.stateEnergy(VoiceAssistantOrbState.LISTENING, frame.time), frame.level, 0.001f)
    assertEquals(1f, frame.weights.listening, 0.001f)
    assertTrue(!frame.additiveGlow)
    assertTrue(frame.isStatic)
  }

  @Test
  fun wireParserAcceptsAllSevenStatesAndFallsBackForUnknownInput() {
    val expected = listOf(
      VoiceAssistantOrbState.IDLE,
      VoiceAssistantOrbState.CONNECTING,
      VoiceAssistantOrbState.LISTENING,
      VoiceAssistantOrbState.THINKING,
      VoiceAssistantOrbState.SPEAKING,
      VoiceAssistantOrbState.ERROR,
      VoiceAssistantOrbState.DISABLED,
    )

    assertEquals(expected, expected.map { VoiceAssistantOrbState.fromWireValue(it.wireValue) })
    assertEquals(VoiceAssistantOrbStyle.PARTICLES, VoiceAssistantOrbStyle.fromWireValue("corrupt"))
    assertEquals(VoiceAssistantOrbState.IDLE, VoiceAssistantOrbState.fromWireValue("corrupt"))
  }

  @Test
  fun audioEnvelopesDoNotLeakAcrossListeningThinkingAndSpeaking() {
    val simulation = ParticlesOrbSimulation(VoiceAssistantOrbState.LISTENING)
    var input = simulation.advance(VoiceAssistantOrbState.LISTENING, 1f, 0f, 1f / 60f)
    assertTrue(input.level > 0f && input.level < 1f)
    repeat(120) { input = simulation.advance(VoiceAssistantOrbState.LISTENING, 1f, 0f, 1f / 60f) }
    val release = simulation.advance(VoiceAssistantOrbState.LISTENING, 0f, 0f, 1f / 60f)
    assertTrue(release.level > 0f && release.level < input.level)
    simulation.advance(VoiceAssistantOrbState.THINKING, 1f, 0f, 1f / 60f)
    val speaking = simulation.advance(VoiceAssistantOrbState.SPEAKING, 1f, 0f, 1f / 60f)
    assertEquals(0f, speaking.level, 0f)
    val attack = simulation.advance(VoiceAssistantOrbState.SPEAKING, 0f, 0.8f, 1f / 60f)
    assertTrue(attack.level > 0f && attack.level < 0.8f)
    repeat(240) { simulation.advance(VoiceAssistantOrbState.SPEAKING, 0f, 1f, 1f / 60f) }
    val listening = simulation.advance(VoiceAssistantOrbState.LISTENING, 0f, 1f, 1f / 60f)
    assertTrue(listening.level < 0.001f)
  }

  private fun settledFrame(
    state: VoiceAssistantOrbState,
    inputLevel: Float? = null,
    playbackLevel: Float? = null,
  ): ParticlesOrbFrame {
    val simulation = ParticlesOrbSimulation()
    var frame = simulation.advance(state, inputLevel, playbackLevel, 0f)
    repeat(240) {
      frame = simulation.advance(state, inputLevel, playbackLevel, 1f / 60f)
    }
    return frame
  }

  private fun channelSpread(color: Int): Int {
    val red = color shr 16 and 0xff
    val green = color shr 8 and 0xff
    val blue = color and 0xff
    return maxOf(red, green, blue) - minOf(red, green, blue)
  }

  private companion object {
    const val SIZE = 66f
    const val CENTER = SIZE / 2f
  }
}
