package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class V2VoiceLevelTest {
  @Test
  fun silenceHasNoAuraLevel() {
    assertEquals(0.0, voiceRmsLevel(shortArrayOf(0, 0, 0), 3), 0.0)
  }

  @Test
  fun loudPcmProducesNormalizedAuraLevel() {
    val level = voiceRmsLevel(shortArrayOf(Short.MAX_VALUE, Short.MIN_VALUE), 2)

    assertTrue(level > 0.99)
    assertTrue(level <= 1.0)
  }

  @Test
  fun ignoresSamplesOutsideTheCapturedCount() {
    assertEquals(0.0, voiceRmsLevel(shortArrayOf(0, Short.MAX_VALUE), 1), 0.0)
  }

  @Test
  fun microphoneForegroundLifetimeEndsOnlyAfterTheFinalCaptureRelease() {
    val lifetime = V2VoiceForegroundLifetime()
    lifetime.acquire("old-capture")
    lifetime.acquire("new-capture")

    assertEquals(false, lifetime.release("old-capture"))
    assertEquals(false, lifetime.isEmpty())
    assertEquals(true, lifetime.release("new-capture"))
    assertEquals(true, lifetime.isEmpty())
  }

  @Test
  fun staleForegroundReleaseCannotStopTheActiveCapture() {
    val lifetime = V2VoiceForegroundLifetime()
    lifetime.acquire("active-capture")

    assertEquals(false, lifetime.release("stale-capture"))
    assertEquals(false, lifetime.isEmpty())
  }
}
