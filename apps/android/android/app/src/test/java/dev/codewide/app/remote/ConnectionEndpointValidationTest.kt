package dev.codewide.app.remote

import org.junit.Assert.assertThrows
import org.junit.Test

class ConnectionEndpointValidationTest {
  @Test
  fun `remote relay carrier requires an exact route-qualified path`() {
    val route = "a".repeat(64)
    validateConnectionEndpoint("ws://45.142.36.65:8780/c/$route/v1/sync")
    assertThrows(IllegalArgumentException::class.java) {
      validateConnectionEndpoint("ws://45.142.36.65:8780/v1/sync")
    }
    assertThrows(IllegalArgumentException::class.java) {
      validateConnectionEndpoint("ws://45.142.36.65:8780/c/short/v1/sync")
    }
    assertThrows(IllegalArgumentException::class.java) {
      validateConnectionEndpoint("ws://45.142.36.65:8780/c/$route/v1/sync?token=unsafe")
    }
  }

  @Test
  fun `ordinary secure endpoint remains valid`() {
    validateConnectionEndpoint("wss://companion.example/v1/sync")
  }
}
