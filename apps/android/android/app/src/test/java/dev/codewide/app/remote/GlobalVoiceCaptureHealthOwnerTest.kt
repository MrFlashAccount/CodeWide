package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlobalVoiceCaptureHealthOwnerTest {
  @Test
  fun foregroundBackgroundForegroundKeepsHealthyCaptureWhenSamplesContinue() {
    var nowMs = 0L
    val events = mutableListOf<GlobalVoiceCaptureHealthEvent>()
    val owner = GlobalVoiceCaptureHealthOwner({ nowMs }, events::add, interruptionTimeoutMs = 1_000L)
    owner.setActive(true)
    owner.setExpectedCapture(true)
    owner.setAudioRecordRunning(true)
    owner.acceptSamples()

    owner.setScreenInteractive(false)
    repeat(4) {
      nowMs += 750L
      owner.acceptSamples()
      owner.check()
    }
    val unlocked = owner.setScreenInteractive(true)

    assertTrue(events.isEmpty())
    assertTrue(unlocked.active)
    assertTrue(unlocked.audioRecordRunning)
    assertTrue(unlocked.expectedCapture)
    assertEquals(0L, unlocked.sampleAgeMs)
  }

  @Test
  fun stalledCapturePublishesOneInterruptionAndRecoversOnFreshSamples() {
    var nowMs = 0L
    val events = mutableListOf<GlobalVoiceCaptureHealthEvent>()
    val owner = GlobalVoiceCaptureHealthOwner({ nowMs }, events::add, interruptionTimeoutMs = 1_000L)
    owner.setActive(true)
    owner.setExpectedCapture(true)
    owner.setAudioRecordRunning(true)
    owner.acceptSamples()
    owner.setScreenInteractive(false)

    nowMs = 1_001L
    owner.check()
    owner.check()
    nowMs = 1_500L
    owner.acceptSamples()

    assertEquals(
      listOf(
        GlobalVoiceCaptureHealthEventKind.INTERRUPTED,
        GlobalVoiceCaptureHealthEventKind.RECOVERED,
      ),
      events.map(GlobalVoiceCaptureHealthEvent::kind),
    )
    assertFalse(events.first().screenInteractive)
    assertEquals(1_001L, events.first().sampleAgeMs)
  }

  @Test
  fun mutedConnectingAndReleasedLifetimesCannotTriggerRecovery() {
    var nowMs = 0L
    val events = mutableListOf<GlobalVoiceCaptureHealthEvent>()
    val owner = GlobalVoiceCaptureHealthOwner({ nowMs }, events::add, interruptionTimeoutMs = 1_000L)
    owner.setActive(true)
    owner.setExpectedCapture(true)
    owner.setMicrophoneMuted(true)
    nowMs = 2_000L
    owner.check()

    owner.setMicrophoneMuted(false)
    owner.setExpectedCapture(false)
    nowMs = 4_000L
    owner.check()

    owner.setExpectedCapture(true)
    owner.setActive(false)
    nowMs = 6_000L
    owner.check()

    assertTrue(events.isEmpty())
  }
}
