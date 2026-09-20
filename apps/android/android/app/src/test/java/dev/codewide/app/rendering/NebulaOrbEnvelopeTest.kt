package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NebulaOrbEnvelopeTest {
  @Test
  fun risesTowardBoundedVoiceEnergyAndReleasesSmoothly() {
    val envelope = NebulaOrbEnvelope()
    envelope.accept(2.0)
    envelope.advance(0.07f)

    assertTrue(envelope.value > 0.6f)
    assertTrue(envelope.value < 1f)

    val peak = envelope.value
    envelope.accept(0.0)
    envelope.advance(0.07f)

    assertTrue(envelope.value > 0f)
    assertTrue(envelope.value < peak)
  }

  @Test
  fun rejectsNonFiniteEnergy() {
    val envelope = NebulaOrbEnvelope()
    envelope.accept(Double.NaN)
    envelope.advance(1f)

    assertEquals(0f, envelope.value, 0f)
  }
}
