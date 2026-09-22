package dev.codewide.app.remote

import org.junit.Assert.*
import org.junit.Test

class VoiceInputRouteOwnerTest {
  private class Platform : VoiceInputRoutePlatform {
    var inputs = listOf(VoiceInputDevice(1, VoiceInputKind.BUILTIN, "Phone"), VoiceInputDevice(8, VoiceInputKind.BLUETOOTH, "Headset"))
    var actual: VoiceInputDevice? = inputs.first()
    var preferred: Int? = null
    var communication = false
    var communicationStarts = 0
    var restores = 0
    var muted = false
    var rejectInput = false
    override fun devices() = inputs
    override fun routedInput() = actual
    override fun preferInput(id: Int?) {
      if (rejectInput && id != null) throw IllegalStateException("Device rejected")
      preferred = id
    }
    override fun communicationRoute(inputId: Int): () -> Unit {
      check(!communication)
      communication = true
      communicationStarts++
      return { communication = false; restores++ }
    }
    override fun muteCapture(muted: Boolean) { this.muted = muted }
  }

  @Test fun systemDefaultAndPhoneNeverAcquireCommunicationOutput() {
    val platform = Platform()
    val owner = VoiceInputRouteOwner(platform, VoiceInputKind.SYSTEM) {}
    owner.start(false)
    assertNull(platform.preferred)
    owner.select(VoiceInputKind.BUILTIN, 1)
    assertEquals(1, platform.preferred)
    owner.setMuted(true)
    assertTrue(platform.muted)
    owner.setMuted(false)
    assertFalse(platform.muted)
    owner.stop()
    assertEquals(0, platform.communicationStarts)
    assertNull(platform.preferred)
  }

  @Test fun disconnectFallsBackToSystemAndRetainsKindRatherThanAnOldAndroidId() {
    val platform = Platform()
    val saved = mutableListOf<VoiceInputKind>()
    val owner = VoiceInputRouteOwner(platform, VoiceInputKind.SYSTEM, saved::add)
    owner.select(VoiceInputKind.BLUETOOTH, 8)
    owner.start(false)
    assertEquals(8, platform.preferred)
    assertTrue(platform.communication)
    platform.inputs = platform.inputs.filter { it.id != 8 }
    owner.devicesChanged()
    assertEquals("unavailable", owner.fallback)
    assertEquals(VoiceInputKind.BLUETOOTH, owner.preference)
    assertNull(platform.preferred)
    assertFalse(platform.communication)
    assertEquals(1, platform.restores)
    owner.stop()
    platform.inputs = platform.inputs + VoiceInputDevice(93, VoiceInputKind.BLUETOOTH, "Headset")
    owner.start(false)
    assertEquals(93, platform.preferred)
    assertEquals(listOf(VoiceInputKind.BLUETOOTH), saved)
    owner.stop()
    owner.stop()
    assertEquals(2, platform.restores)
  }

  @Test fun rejectedOrUnconfirmedRouteRestoresOutputAndExposesActualInput() {
    val platform = Platform()
    val owner = VoiceInputRouteOwner(platform, VoiceInputKind.BLUETOOTH) {}
    owner.start(false)
    // Preferred-device API success is not proof that Android actually routed it.
    assertEquals(VoiceInputKind.BUILTIN, platform.routedInput()?.kind)
    owner.verifyRouting()
    assertEquals("routeRejected", owner.fallback)
    assertNull(owner.selected)
    assertFalse(platform.communication)
    assertEquals(1, platform.restores)
    platform.rejectInput = true
    owner.select(VoiceInputKind.BLUETOOTH, 8)
    assertEquals("routeRejected", owner.fallback)
    assertFalse(platform.communication)
    assertEquals(2, platform.restores)
    owner.stop()
  }

  @Test fun stopRestoresOutputAndCaptureGateExactlyOnce() {
    val platform = Platform()
    val owner = VoiceInputRouteOwner(platform, VoiceInputKind.BLUETOOTH) {}
    owner.start(true)
    assertTrue(platform.muted)
    owner.stop()
    owner.stop()
    assertFalse(owner.active)
    assertFalse(platform.communication)
    assertFalse(platform.muted)
    assertNull(platform.preferred)
    assertEquals(1, platform.restores)
  }
}
