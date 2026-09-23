package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlobalVoiceWakeLockOwnerTest {
  @Test
  fun holdsOnlyDuringGlobalVoiceActivationAndReleasesIdempotently() {
    val wakeLock = FakeGlobalVoiceWakeLock()
    val owner = GlobalVoiceWakeLockOwner(wakeLock)

    owner.setActivationActive(true)
    owner.setActivationActive(true)
    assertTrue(wakeLock.isHeld)
    assertEquals(1, wakeLock.acquireCount)
    assertTrue(wakeLock.lastTimeoutMs > 15L * 60L * 1_000L)

    // Microphone mute is deliberately absent from this owner: the logical activation,
    // playback, worker attention and reconnect still need CPU wakefulness while muted.
    owner.setActivationActive(false)
    owner.setActivationActive(false)
    assertFalse(wakeLock.isHeld)
    assertEquals(1, wakeLock.releaseCount)
  }

  private class FakeGlobalVoiceWakeLock : GlobalVoiceWakeLock {
    override var isHeld = false
    var acquireCount = 0
    var releaseCount = 0
    var lastTimeoutMs = 0L

    override fun acquire(timeoutMs: Long) {
      isHeld = true
      acquireCount += 1
      lastTimeoutMs = timeoutMs
    }

    override fun release() {
      isHeld = false
      releaseCount += 1
    }
  }
}
