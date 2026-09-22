package dev.codewide.app.rendering

import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import org.junit.Assert.*
import org.junit.Test

class OrbListeningParametersTest {
  private val dt = 1f / 60f

  private fun settled(state: VoiceAssistantOrbState, input: Float): ParticlesOrbFrame {
    val simulation = ParticlesOrbSimulation(state)
    var frame = simulation.advance(state, input, 0f, 0f)
    repeat(120) { frame = simulation.advance(state, input, 0f, dt) }
    return frame
  }

  @Test fun listeningHasSubstantialProjectedMotionDistinctFromIdleThinkingAndConnecting() {
    val points = ParticlesOrbModel.buildSphere()
    val listening = settled(VoiceAssistantOrbState.LISTENING, 0.03f)
    assertTrue(listening.ripple > 0.99f)
    assertTrue(listening.pulse < 0.01f)
    assertTrue(listening.weights.connecting < 0.01f)
    val summary = StringBuilder("Synthetic RMS fixtures; not measured microphone levels. 66dp renderer.\n")
    for (state in listOf(VoiceAssistantOrbState.IDLE, VoiceAssistantOrbState.THINKING, VoiceAssistantOrbState.CONNECTING)) {
      val other = settled(state, 0.03f)
      var displacement = 0.0
      for (index in points.indices) {
        val a = ParticlesOrbModel.project(points[index], index, listening, 66f, 1f)
        val b = ParticlesOrbModel.project(points[index], index, other, 66f, 1f)
        displacement += hypot(a.x - b.x, a.y - b.y)
      }
      val meanDp = displacement / points.size
      // A multi-dp displacement of individually retained dots is a meaningful motion difference
      // in a 66dp orb, unlike a test that merely checks different floating-point values.
      assertTrue("listening vs $state: $meanDp dp", meanDp > 3.0)
      summary.append("listening vs $state mean dot displacement=$meanDp dp\n")
    }
    val silent = settled(VoiceAssistantOrbState.LISTENING, 0f)
    val ordinaryFixture = settled(VoiceAssistantOrbState.LISTENING, 0.03f)
    val loudFixture = settled(VoiceAssistantOrbState.LISTENING, 0.1f)
    for ((label, frame) in listOf("silence" to silent, "rms_0.03" to ordinaryFixture, "rms_0.1" to loudFixture)) {
      val rippleAmplitude = frame.ripple * (0.045f + frame.level * 0.24f)
      summary.append("$label level=${frame.level} radiusScale=${frame.radiusScale} ripple=$rippleAmplitude angleY=${frame.angleY}\n")
    }
    assertTrue(ordinaryFixture.level > silent.level)
    assertTrue(loudFixture.level > ordinaryFixture.level)
    assertTrue(loudFixture.radiusScale > ordinaryFixture.radiusScale)
    val report = File("build/reports/voice-overlay/listening-parameters.txt")
    requireNotNull(report.parentFile).mkdirs()
    report.writeText(summary.toString())
  }

  @Test fun particlesSpeechAttackAndReleaseAreSmoothAndKeepUpstreamRippleGeometry() {
    val simulation = ParticlesOrbSimulation(VoiceAssistantOrbState.LISTENING)
    var frame = simulation.advance(VoiceAssistantOrbState.LISTENING, 0f, 0f, dt)
    var previous = frame.level
    repeat(18) {
      frame = simulation.advance(VoiceAssistantOrbState.LISTENING, 0.1f, 1f, dt)
      assertTrue(frame.level >= previous)
      assertTrue(frame.level - previous < 0.015f)
      previous = frame.level
    }
    assertTrue("attack reaches most of the real input in 300ms", frame.level > 0.075f)
    repeat(60) { index ->
      frame = simulation.advance(VoiceAssistantOrbState.LISTENING, 0f, 1f, dt)
      // The upstream two-stage envelope can coast briefly after the input drops. Bound the
      // tail by the actual input peak; require decay after the first 100ms, not a hard cut.
      assertTrue(frame.level < 0.1f)
      if (index >= 6) assertTrue(frame.level <= previous)
      assertTrue(abs(previous - frame.level) < 0.015f)
      previous = frame.level
    }
    assertTrue("release approaches silence in one second", frame.level < 0.005f)
    assertTrue(frame.ripple > 0.99f)
  }

  @Test fun nebulaUniformResponseIsMeasuredSeparatelyFromSemanticState() {
    val state = VoiceAssistantOrbState.LISTENING
    val envelope = NebulaOrbEnvelope()
    envelope.accept(0.03)
    envelope.advance(0.07f)
    assertTrue(envelope.value in 0.018f..0.020f)
    val speed = NebulaOrbMotion.animationSpeed(state, envelope.value, 1f)
    assertTrue(speed > NebulaOrbMotion.animationSpeed(VoiceAssistantOrbState.IDLE, 1f, 1f) * 1.4f)
    // Characterizes the existing weak amplitude response rather than claiming visual salience.
    val turbulence = NebulaOrbMotion.turbulence(state, envelope.value, 1f)
    assertTrue(abs(turbulence - 1.2f) < 0.02f)
    envelope.accept(0.1)
    envelope.advance(0.3f)
    assertTrue(NebulaOrbMotion.turbulence(state, envelope.value, 0f) > turbulence)
    val peak = envelope.value
    envelope.accept(0.0)
    envelope.advance(0.3f)
    assertTrue(envelope.value in 0f..peak * 0.4f)
  }
}
