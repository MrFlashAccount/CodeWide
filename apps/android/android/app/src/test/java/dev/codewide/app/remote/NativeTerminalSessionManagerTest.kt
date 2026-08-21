package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTerminalSessionManagerTest {
  @Test
  fun derivesPinnedTerminalEndpointAndEncodesWorkingDirectory() {
    assertEquals(
      "wss://codex.example.test/v1/terminals?cwd=%2Fworkspace%2Fwith%20spaces&cols=120&rows=40&sessionId=terminal-12345678-1234-1234-1234-123456789abc&offset=42&create=false",
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/v1/sync",
        "/workspace/with spaces",
        120,
        40,
        "terminal-12345678-1234-1234-1234-123456789abc",
        42,
        false,
      ),
    )
  }

  @Test
  fun preservesLocalDevelopmentWebSocketScheme() {
    assertEquals(
      "ws://10.0.2.2:8765/v1/terminals?cols=80&rows=24&sessionId=terminal-12345678-1234-1234-1234-123456789abc&offset=0&create=true",
      NativeTerminalSessionManager.terminalEndpoint(
        "ws://10.0.2.2:8765/v1/sync",
        null,
        80,
        24,
        "terminal-12345678-1234-1234-1234-123456789abc",
        0,
        true,
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
        "terminal-12345678-1234-1234-1234-123456789abc",
        0,
        true,
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/not-sync",
        null,
        80,
        24,
        "terminal-12345678-1234-1234-1234-123456789abc",
        0,
        true,
      )
    }
  }
}
