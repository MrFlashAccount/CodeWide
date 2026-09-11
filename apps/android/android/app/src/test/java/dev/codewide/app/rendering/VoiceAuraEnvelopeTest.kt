package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceAuraEnvelopeTest {
  @Test
  fun silenceAndInvalidInputStayDark() {
    for (input in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
      val envelope = VoiceAuraEnvelope()
      envelope.accept(input)
      assertEquals(0f, envelope.advance(1f), 0f)
    }
  }

  @Test
  fun speechChangesTheEnvelopeWithoutRestartingIt() {
    val envelope = VoiceAuraEnvelope()
    envelope.accept(0.02)
    val quiet = envelope.advance(1f)
    envelope.accept(0.2)
    val loud = envelope.advance(1f)
    assertTrue(quiet > 0f)
    assertTrue(loud > quiet + 0.2f)
    assertTrue(loud <= 1f)
    envelope.accept(0.0)
    val releasing = envelope.advance(0.05f)
    assertTrue(releasing > 0f && releasing < loud)
    assertTrue(envelope.advance(2f) < 0.001f)
  }

  @Test
  fun sameElapsedTimeHasSameResponseAt60And120Hz() {
    fun sample(frames: Int): Float {
      val envelope = VoiceAuraEnvelope()
      envelope.accept(0.1)
      repeat(frames) { envelope.advance(0.1f / frames) }
      return envelope.value
    }
    assertEquals(sample(6), sample(12), 0.00001f)
  }

  @Test
  fun attackIsFasterThanReleaseAndResetDropsPreviousCapture() {
    val envelope = VoiceAuraEnvelope()
    envelope.accept(1.0)
    val attack = envelope.advance(0.05f)
    assertTrue(attack > 0.6f)
    envelope.accept(0.0)
    val remaining = envelope.advance(0.05f)
    assertTrue(remaining > attack * 0.7f)
    envelope.reset()
    assertEquals(0f, envelope.advance(1f), 0f)
  }
}
