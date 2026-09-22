package dev.codewide.app.remote

import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalVoiceFeaturesTest {
  @Test
  fun `keeps a nearby voiceprint above a distinct pitch and spectrum`() {
    val enrolled = requireNotNull(PersonalVoiceFeatures.embedding(syntheticVoice(118.0, 0.0, 6)))
    val sameSpeaker = requireNotNull(PersonalVoiceFeatures.embedding(syntheticVoice(121.0, 0.8, 1)))
    val otherSpeaker = requireNotNull(PersonalVoiceFeatures.embedding(syntheticVoice(205.0, 0.4, 1)))

    assertTrue(PersonalVoiceFeatures.similarity(enrolled, sameSpeaker) > 0.9)
    assertTrue(PersonalVoiceFeatures.similarity(enrolled, otherSpeaker) < 0.75)
  }

  @Test
  fun `classifies a short admission window without waiting for one second`() {
    val enrolled = requireNotNull(PersonalVoiceFeatures.embedding(syntheticVoice(118.0, 0.0, 6)))
    val sameSpeaker = requireNotNull(
      PersonalVoiceFeatures.embedding(syntheticVoiceMilliseconds(121.0, 0.8, 120)),
    )
    val otherSpeaker = requireNotNull(
      PersonalVoiceFeatures.embedding(syntheticVoiceMilliseconds(205.0, 0.4, 120)),
    )

    assertTrue(PersonalVoiceFeatures.similarity(enrolled, sameSpeaker) > 0.9)
    assertTrue(PersonalVoiceFeatures.similarity(enrolled, otherSpeaker) < 0.75)
  }

  @Test
  fun `rejects a silent enrollment`() {
    assertNull(PersonalVoiceFeatures.embedding(ShortArray(PersonalVoiceFeatures.SAMPLE_RATE * 6)))
  }

  private fun syntheticVoice(
    fundamentalHz: Double,
    phase: Double,
    seconds: Int,
  ): ShortArray = syntheticVoiceSamples(
    fundamentalHz,
    phase,
    PersonalVoiceFeatures.SAMPLE_RATE * seconds,
  )

  private fun syntheticVoiceMilliseconds(
    fundamentalHz: Double,
    phase: Double,
    milliseconds: Int,
  ): ShortArray = syntheticVoiceSamples(
    fundamentalHz,
    phase,
    PersonalVoiceFeatures.SAMPLE_RATE * milliseconds / 1_000,
  )

  private fun syntheticVoiceSamples(
    fundamentalHz: Double,
    phase: Double,
    sampleCount: Int,
  ): ShortArray = ShortArray(sampleCount) { index ->
    val time = index.toDouble() / PersonalVoiceFeatures.SAMPLE_RATE
    val envelope = 0.55 + 0.45 * sin(2 * PI * 3.1 * time + phase)
    val signal = envelope * (
      sin(2 * PI * fundamentalHz * time + phase) +
        0.5 * sin(2 * PI * fundamentalHz * 2 * time) +
        0.22 * sin(2 * PI * fundamentalHz * 3 * time + 0.3)
      )
    (signal * 8_000).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
  }
}
