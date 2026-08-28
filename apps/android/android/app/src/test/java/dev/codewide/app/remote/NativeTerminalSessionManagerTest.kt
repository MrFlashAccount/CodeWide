package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTerminalSessionManagerTest {
  @Test
  fun identifiesPersistedThreadWithoutSendingItsWorkingDirectory() {
    assertEquals(
      "wss://codex.example.test/v1/terminals?threadId=01a03e19-ee87-7a33-adcb-a93b9e5b0768&cols=120&rows=40&sessionId=terminal-12345678-1234-1234-1234-123456789abc&offset=42&create=false",
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/v1/sync",
        "01a03e19-ee87-7a33-adcb-a93b9e5b0768",
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
  fun sendsExplicitWorkingDirectoryOnlyForAnUnpersistedDraft() {
    assertEquals(
      "wss://codex.example.test/v1/terminals?cwd=%2Fworkspace%2Fwith%20spaces&cols=120&rows=40&sessionId=terminal-12345678-1234-1234-1234-123456789abc&offset=0&create=true",
      NativeTerminalSessionManager.terminalEndpoint(
        "wss://codex.example.test/v1/sync",
        "new-chat-1",
        "/workspace/with spaces",
        120,
        40,
        "terminal-12345678-1234-1234-1234-123456789abc",
        0,
        true,
      ),
    )
  }

  @Test
  fun preservesLocalDevelopmentWebSocketScheme() {
    assertEquals(
      "ws://10.0.2.2:8765/v1/terminals?cols=80&rows=24&sessionId=terminal-12345678-1234-1234-1234-123456789abc&offset=0&create=true",
      NativeTerminalSessionManager.terminalEndpoint(
        "ws://10.0.2.2:8765/v1/sync",
        "new-chat-1",
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
        "new-chat-1",
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
        "new-chat-1",
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
