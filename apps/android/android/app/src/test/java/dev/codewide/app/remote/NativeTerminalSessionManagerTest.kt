package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTerminalSessionManagerTest {
  @Test
  fun derivesPinnedTerminalEndpointAndEncodesWorkingDirectory() {
    assertEquals(
      "wss://codex.example.test/v1/terminals?cwd=%2Fworkspace%2Fwith%20spaces&cols=120&rows=40",
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/v1/sync",
        "/workspace/with spaces",
        120,
        40,
      ),
    )
  }

  @Test
  fun preservesLocalDevelopmentWebSocketScheme() {
    assertEquals(
      "ws://10.0.2.2:8765/v1/terminals?cols=80&rows=24",
      NativeTerminalSessionManager.terminalEndpoint(
        "ws://10.0.2.2:8765/v1/sync",
        null,
        80,
        24,
      ),
    )
  }

  @Test
  fun rejectsNonWebSocketAndNonSyncEndpoints() {
    assertThrows(IllegalStateException::class.java) {
      NativeTerminalSessionManager.terminalEndpoint(
        "https://codex.example.test/v1/sync",
        null,
        80,
        24,
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/not-sync",
        null,
        80,
        24,
      )
    }
  }
}
