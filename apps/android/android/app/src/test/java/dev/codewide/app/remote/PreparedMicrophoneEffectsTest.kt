package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PreparedMicrophoneEffectsTest {
  private class FakeEffect(private val controlled: Boolean) : MicrophoneAudioEffect {
    var releases = 0
    var enableCalls = 0

    override fun enableWhenControlled(): Boolean {
      enableCalls += 1
      return controlled
    }

    override fun release() {
      releases += 1
    }
  }

  private class FakePlatform(
    override val acousticEchoCancelerSupported: Boolean,
    private val echo: FakeEffect?,
    private val noise: FakeEffect? = null,
    private val gain: FakeEffect? = null,
  ) : MicrophoneEffectsPlatform {
    override val automaticGainControlSupported: Boolean = gain != null
    override val noiseSuppressorSupported: Boolean = noise != null
    var echoCreations = 0

    override fun createAcousticEchoCanceler(audioSessionId: Int): MicrophoneAudioEffect? {
      echoCreations += 1
      return echo
    }

    override fun createAutomaticGainControl(audioSessionId: Int): MicrophoneAudioEffect? = gain

    override fun createNoiseSuppressor(audioSessionId: Int): MicrophoneAudioEffect? = noise
  }

  @Test
  fun ownsEnabledEffectsAndReleasesEachExactlyOnce() {
    val echo = FakeEffect(controlled = true)
    val noise = FakeEffect(controlled = true)
    val gain = FakeEffect(controlled = false)
    val effects = PreparedMicrophoneEffectsFactory(
      FakePlatform(true, echo, noise, gain),
    ) { _, _ -> error("unexpected setup failure") }.create(42)

    assertTrue(effects.acousticEchoCancelerSupported)
    assertTrue(effects.acousticEchoCancelerEnabled)
    assertTrue(effects.noiseSuppressor?.enabled == true)
    assertFalse(effects.automaticGainControl?.enabled == true)

    effects.release()
    effects.release()

    assertEquals(1, echo.releases)
    assertEquals(1, noise.releases)
    assertEquals(1, gain.releases)
  }

  @Test
  fun unsupportedEchoCancellationFallsBackWithoutCreatingAnEffect() {
    val platform = FakePlatform(false, FakeEffect(controlled = true))
    val effects = PreparedMicrophoneEffectsFactory(platform) { _, _ ->
      error("unexpected setup failure")
    }.create(43)

    assertFalse(effects.acousticEchoCancelerSupported)
    assertFalse(effects.acousticEchoCancelerEnabled)
    assertNull(effects.acousticEchoCanceler)
    assertEquals(0, platform.echoCreations)
  }

  @Test
  fun setupFailureReleasesTheCreatedEffectAndFallsBack() {
    val echo = object : MicrophoneAudioEffect {
      var releases = 0

      override fun enableWhenControlled(): Boolean = error("enable failed")

      override fun release() {
        releases += 1
      }
    }
    val failures = mutableListOf<String>()
    val platform = object : MicrophoneEffectsPlatform {
      override val acousticEchoCancelerSupported = true
      override val automaticGainControlSupported = false
      override val noiseSuppressorSupported = false

      override fun createAcousticEchoCanceler(audioSessionId: Int) = echo
      override fun createAutomaticGainControl(audioSessionId: Int): MicrophoneAudioEffect? = null
      override fun createNoiseSuppressor(audioSessionId: Int): MicrophoneAudioEffect? = null
    }

    val effects = PreparedMicrophoneEffectsFactory(platform) { name, _ -> failures += name }.create(44)

    assertNull(effects.acousticEchoCanceler)
    assertTrue(effects.acousticEchoCancelerSupported)
    assertFalse(effects.acousticEchoCancelerEnabled)
    assertEquals(1, echo.releases)
    assertEquals(listOf("Acoustic echo cancellation"), failures)
  }

  @Test
  fun releaseAttemptsEveryOwnedEffectWhenOneReleaseFails() {
    val echo = object : MicrophoneAudioEffect {
      var releases = 0

      override fun enableWhenControlled(): Boolean = true

      override fun release() {
        releases += 1
        error("echo release failed")
      }
    }
    val noise = FakeEffect(controlled = true)
    val platform = object : MicrophoneEffectsPlatform {
      override val acousticEchoCancelerSupported = true
      override val automaticGainControlSupported = false
      override val noiseSuppressorSupported = true

      override fun createAcousticEchoCanceler(audioSessionId: Int) = echo
      override fun createAutomaticGainControl(audioSessionId: Int): MicrophoneAudioEffect? = null
      override fun createNoiseSuppressor(audioSessionId: Int): MicrophoneAudioEffect = noise
    }
    val effects = PreparedMicrophoneEffectsFactory(platform) { _, _ ->
      error("unexpected setup failure")
    }.create(45)

    val failure = runCatching { effects.release() }.exceptionOrNull()

    assertEquals("echo release failed", failure?.message)
    assertEquals(1, echo.releases)
    assertEquals(1, noise.releases)
    effects.release()
    assertEquals(1, echo.releases)
    assertEquals(1, noise.releases)
  }
}
