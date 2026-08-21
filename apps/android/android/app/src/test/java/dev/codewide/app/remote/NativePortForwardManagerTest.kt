package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

  @Test
  fun unavailableForwardDoesNotExposeADeadPreviewUrl() {
    val profile = StoredPortForward(
      id = "forward-test",
      connectionId = "server-test",
      label = "Vite",
      remotePort = 4_173,
      preferredLocalPort = null,
      serviceKey = "a".repeat(64),
      preference = "automatic",
      enabled = true,
      updatedAt = 1,
    )

    val projection = PortForwardProjection(
      profile = profile,
      localPort = 46_213,
      status = "unavailable",
      error = "Nothing is listening on remote localhost:4173",
    ).json()

    assertTrue(projection.isNull("previewUrl"))
    assertEquals("unavailable", projection.getString("status"))
  }
}
