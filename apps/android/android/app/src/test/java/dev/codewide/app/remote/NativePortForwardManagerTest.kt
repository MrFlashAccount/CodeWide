package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativePortForwardManagerTest {
  @Test
  fun derivesSecurePortForwardEndpointFromSyncEndpoint() {
    assertEquals(
      "wss://codex.example.test/v1/port-forwards/3000",
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/v1/sync", 3000),
    )
  }

  @Test
  fun preservesLocalDevelopmentEndpointAuthority() {
    assertEquals(
      "ws://10.0.2.2:8765/v1/port-forwards/8080",
      NativePortForwardManager.portForwardEndpoint("ws://10.0.2.2:8765/v1/sync", 8080),
    )
  }

  @Test
  fun derivesHttpDiscoveryEndpointFromSyncEndpoint() {
    assertEquals(
      "https://codex.example.test/v1/port-forwards/discovery",
      NativePortForwardManager.portDiscoveryEndpoint("wss://codex.example.test/v1/sync"),
    )
    assertEquals(
      "http://10.0.2.2:8765/v1/port-forwards/discovery",
      NativePortForwardManager.portDiscoveryEndpoint("ws://10.0.2.2:8765/v1/sync"),
    )
  }

  @Test
  fun rejectsInvalidEndpointAndPort() {
    assertThrows(IllegalStateException::class.java) {
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/not-sync", 3000)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/v1/sync", 0)
    }
  }
}
