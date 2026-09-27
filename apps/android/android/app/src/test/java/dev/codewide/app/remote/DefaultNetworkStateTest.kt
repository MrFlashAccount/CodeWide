package dev.codewide.app.remote

import org.junit.Assert.*
import org.junit.Test

class DefaultNetworkStateTest {
  @Test fun oldRouteLossCannotDisconnectNewDefaultNetwork() {
    val state = DefaultNetworkState<String>()
    state.available("wifi")
    state.capabilities("wifi", true, false)
    state.available("cellular")
    val epoch = state.epoch
    assertFalse(state.lost("wifi"))
    assertFalse(state.capabilities("wifi", false, true))
    assertFalse(state.blocked("wifi", true))
    assertEquals(epoch, state.epoch)
    assertTrue(state.canAttempt)
    assertEquals(NetworkAvailability.UNVALIDATED, state.availability)
  }

  @Test fun validationAndPortalAreObservationsNotAServiceAdmissionGate() {
    val state = DefaultNetworkState<String>()
    state.absent()
    assertFalse(state.canAttempt)
    state.available("vpn")
    assertTrue(state.canAttempt)
    state.capabilities("vpn", false, true)
    assertEquals(NetworkAvailability.CAPTIVE, state.availability)
    assertTrue(state.canAttempt)
    state.blocked("vpn", true)
    assertFalse(state.canAttempt)
    state.capabilities("vpn", true, false)
    assertEquals(NetworkAvailability.BLOCKED, state.availability)
    state.blocked("vpn", false)
    assertTrue(state.canAttempt)
    assertEquals(NetworkAvailability.VALIDATED, state.availability)
    assertTrue(state.lost("vpn"))
    assertFalse(state.canAttempt)
  }
}
