package dev.codewide.app.remote

import android.media.AudioFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GlobalVoiceAudioLevelOwnerTest {
  @Test
  fun keepsIndependentInputAndPlaybackLevelsAcrossHostVisibilityChanges() {
    val queued = mutableListOf<() -> Unit>()
    val published = mutableListOf<GlobalVoiceAudioLevels>()
    var nowNanos = 0L
    val owner = GlobalVoiceAudioLevelOwner(queued::add, { nowNanos }, published::add)
    owner.setActive(true)

    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(16_384))
    owner.acceptPlaybackLevel(0.75)
    assertEquals(1, queued.size)
    queued.removeAt(0).invoke()

    assertEquals(0.5, published.single().input, 0.0001)
    assertEquals(0.75, published.single().playback, 0.0)

    // Activity visibility does not participate in this foreground-service-owned lifecycle.
    nowNanos += 100_000_000L
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(8_192))
    queued.removeAt(0).invoke()
    nowNanos += 100_000_000L
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(24_576))
    queued.removeAt(0).invoke()

    assertEquals(3, published.size)
    assertEquals(0.25, published[1].input, 0.0001)
    assertEquals(0.75, published[2].input, 0.0001)
    assertEquals(0.75, published[2].playback, 0.0)
  }

  @Test
  fun releaseStopsDeliveryAndUnsupportedPcmIsIgnored() {
    val queued = mutableListOf<() -> Unit>()
    val published = mutableListOf<GlobalVoiceAudioLevels>()
    val owner = GlobalVoiceAudioLevelOwner(queued::add, { 0L }, published::add)
    owner.setActive(true)

    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_FLOAT, 1, pcm16(16_384))
    assertTrue(queued.isEmpty())

    owner.setActive(false)
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(16_384))
    owner.acceptPlaybackLevel(1.0)

    assertTrue(queued.isEmpty())
    assertTrue(published.isEmpty())
  }

  @Test
  fun staleMainThreadDeliveryCannotCrossAReleasedAndReacquiredLifetime() {
    val queued = mutableListOf<() -> Unit>()
    val published = mutableListOf<GlobalVoiceAudioLevels>()
    var nowNanos = 0L
    val owner = GlobalVoiceAudioLevelOwner(queued::add, { nowNanos }, published::add)
    owner.setActive(true)
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(16_384))
    val staleDelivery = queued.removeAt(0)

    owner.setActive(false)
    owner.setActive(true)
    nowNanos += 100_000_000L
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(8_192))
    val currentDelivery = queued.removeAt(0)
    staleDelivery()
    currentDelivery()

    assertEquals(1, published.size)
    assertEquals(0.25, published.single().input, 0.0001)
  }

  @Test
  fun mutedMicrophoneDropsInputAndPublishesZeroWithoutSuppressingPlayback() {
    val queued = mutableListOf<() -> Unit>()
    val published = mutableListOf<GlobalVoiceAudioLevels>()
    var nowNanos = 0L
    val owner = GlobalVoiceAudioLevelOwner(queued::add, { nowNanos }, published::add)
    owner.setActive(true)
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(16_384))
    queued.removeAt(0).invoke()

    nowNanos += 100_000_000L
    owner.setMicrophoneMuted(true)
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(24_576))
    owner.acceptPlaybackLevel(0.6)
    queued.removeAt(0).invoke()

    assertEquals(0.0, published.last().input, 0.0)
    assertEquals(0.6, published.last().playback, 0.0)

    nowNanos += 100_000_000L
    owner.setMicrophoneMuted(false)
    owner.acceptInputPcm(AudioFormat.ENCODING_PCM_16BIT, 1, pcm16(8_192))
    queued.removeAt(0).invoke()
    assertEquals(0.25, published.last().input, 0.0001)
  }

  private fun pcm16(sample: Int): ByteArray {
    val bounded = sample.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
    return byteArrayOf((bounded and 0xff).toByte(), ((bounded shr 8) and 0xff).toByte())
  }
}
