package dev.codewide.app.remote

import android.media.AudioFormat
import dev.codewide.app.rendering.ParticlesOrbFrame
import dev.codewide.app.rendering.ParticlesOrbModel
import dev.codewide.app.rendering.ParticlesOrbSimulation
import dev.codewide.app.rendering.VoiceAssistantOrbState
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.*
import org.junit.Test

class GlobalVoiceParticlesInputTest {
  private val listening = VoiceAssistantOrbState.LISTENING

  @Test fun matchesOriginalBrowserMicrophoneAdapterAtBothCaptureRates() {
    // Chromium AnalyserNode + pinned upstream useAudioLevel, 120 frames at 60Hz.
    // These are amplitude-contract references, not snapshots of internal FFT arrays.
    // Four 300 Hz harmonics with 1/h amplitudes, normalized to the stated RMS.
    val references = listOf(
      Triple(16_000, 0.03, 0.3324), Triple(16_000, 0.1, 0.4525),
      Triple(48_000, 0.03, 0.4786), Triple(48_000, 0.1, 0.6217),
    )
    val report = StringBuilder("Synthetic voiced PCM; not measured human speech.\n")
    for ((rate, rms, expected) in references) {
      val adapter = ParticlesVoiceInputLevel()
      val pcm = voicedPcm(rate, rms)
      val actual = adapter.accept(1, rate, pcm)
      // Browser render scheduling and PCM16 quantization vary; 0.03 still rejects raw RMS.
      assertEquals("sampleRate=$rate RMS=$rms", expected, actual, 0.03)
      assertTrue(actual > rms * 4)
      report.append("sampleRate=$rate RMS=$rms browser=$expected native=$actual\n")
    }
    val file = File("build/reports/voice-overlay/particles-microphone-parity.txt")
    requireNotNull(file.parentFile).mkdirs()
    file.writeText(report.toString())
  }

  @Test fun silenceOrdinaryAndLoudFixturesProduceSubstantialRadialResponseAtOverlaySize() {
    fun settled(rms: Double): ParticlesOrbFrame {
      val level = ParticlesVoiceInputLevel().accept(1, 48_000, voicedPcm(48_000, rms)).toFloat()
      val simulation = ParticlesOrbSimulation(listening)
      var frame = simulation.advance(listening, level, 0f, 0f)
      repeat(120) { frame = simulation.advance(listening, level, 0f, 1f / 60f) }
      return frame
    }
    val silent = settled(0.0)
    val ordinary = settled(0.03)
    val loud = settled(0.1)
    assertEquals(0f, silent.level, 0f)
    assertTrue(ordinary.level > 0.4f)
    assertTrue(loud.level > ordinary.level + 0.1f)
    assertTrue(ordinary.radiusScale - silent.radiusScale > 0.06f)
    assertTrue((0.045f + ordinary.level * 0.24f) > 3f * 0.045f)
    // Hold angle/time constant: this measures audio deformation, not dot rotation identity.
    val aligned = ordinary.copy(angleY = silent.angleY)
    val points = ParticlesOrbModel.buildSphere()
    val radialDelta = points.mapIndexed { index, point ->
      val a = ParticlesOrbModel.project(point, index, silent, 66f, 1f)
      val b = ParticlesOrbModel.project(point, index, aligned, 66f, 1f)
      abs(hypot(b.x - 33f, b.y - 33f) - hypot(a.x - 33f, a.y - 33f))
    }.average()
    assertTrue("radial response at 66dp: $radialDelta", radialDelta > 1.0)
  }

  @Test fun completeInputAndRendererChainHasPromptSmoothAttackAndRelease() {
    val adapter = ParticlesVoiceInputLevel()
    val simulation = ParticlesOrbSimulation(listening)
    val pcm = voicedPcm(48_000, 0.03)
    var previous = 0f
    var frame = simulation.advance(listening, 0f, 0f, 0f)
    repeat(60) { tick ->
      val chunk = pcm.copyOfRange(tick * 1600, (tick + 1) * 1600)
      val level = adapter.accept(1, 48_000, chunk).toFloat()
      frame = simulation.advance(listening, level, 1f, 1f / 60f)
      assertTrue(abs(frame.level - previous) < 0.04f)
      if (tick == 17) assertTrue("readable onset within 300ms", frame.level > 0.18f)
      previous = frame.level
    }
    assertTrue(frame.level > 0.4f)
    repeat(90) {
      val level = adapter.accept(1, 48_000, ByteArray(1600)).toFloat()
      frame = simulation.advance(listening, level, 1f, 1f / 60f)
      assertTrue(abs(frame.level - previous) < 0.04f)
      previous = frame.level
    }
    assertTrue("release to quiet without using playback input", frame.level < 0.01f)
  }

  @Test fun callbackSegmentationStereoAndSampleRateReplacementPreserveTheInputContract() {
    val pcm = voicedPcm(48_000, 0.03)
    val whole = ParticlesVoiceInputLevel().accept(1, 48_000, pcm)
    val segmented = ParticlesVoiceInputLevel()
    for (offset in pcm.indices step 960) segmented.accept(1, 48_000, pcm.copyOfRange(offset, offset + 960))
    assertEquals(whole, segmented.value, 1e-12)
    val stereo = ByteArray(pcm.size * 2)
    for (offset in pcm.indices step 2) {
      stereo[offset * 2] = pcm[offset]
      stereo[offset * 2 + 1] = pcm[offset + 1]
      stereo[offset * 2 + 2] = pcm[offset]
      stereo[offset * 2 + 3] = pcm[offset + 1]
    }
    assertEquals(whole, ParticlesVoiceInputLevel().accept(2, 48_000, stereo), 1e-12)
    assertEquals(0.0, segmented.accept(1, 16_000, ByteArray(640)), 0.0)
  }

  @Test fun serviceOwnerKeepsRmsSeparateAndClearsSpectralHistoryOnMuteAndStop() {
    val delivered = mutableListOf<GlobalVoiceAudioLevels>()
    var time = 0L
    val owner = GlobalVoiceAudioLevelOwner({ it() }, { time }, delivered::add)
    fun input(pcm: ByteArray) {
      time += 100_000_000L
      owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, 48_000, pcm)
    }
    owner.setActive(true)
    input(voicedPcm(48_000, 0.03))
    assertEquals(0.03, delivered.last().input, 0.0001)
    assertTrue(delivered.last().particlesInput > 0.4)
    owner.setMicrophoneMuted(true)
    assertEquals(0.0, delivered.last().particlesInput, 0.0)
    input(voicedPcm(48_000, 0.1))
    owner.setMicrophoneMuted(false)
    input(ByteArray(1600))
    assertEquals(0.0, delivered.last().particlesInput, 0.0)
    input(voicedPcm(48_000, 0.1))
    owner.setActive(false)
    val count = delivered.size
    input(voicedPcm(48_000, 0.1))
    assertEquals(count, delivered.size)
    owner.setActive(true)
    input(ByteArray(1600))
    assertEquals(0.0, delivered.last().particlesInput, 0.0)
  }

  private fun voicedPcm(rate: Int, rms: Double): ByteArray {
    val data = ByteArray(rate * 2 * 2)
    val scale = rms * sqrt(2.0 / (1.0 + 0.25 + 1.0 / 9 + 0.0625))
    for (frame in 0 until rate * 2) {
      var sample = 0.0
      for (harmonic in 1..4) sample += scale / harmonic * sin(2 * PI * 300 * harmonic * frame / rate)
      val pcm = (sample * 32_768).toInt().coerceIn(-32_768, 32_767)
      data[frame * 2] = pcm.toByte()
      data[frame * 2 + 1] = (pcm shr 8).toByte()
    }
    return data
  }
}
