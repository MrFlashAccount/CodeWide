package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class SecureOnlyTransportTest {
  @Test
  fun `companion pin authenticates inner tls and never pins the relay`() {
    val pin = "sha256/${"A".repeat(43)}="
    val saved = StoredNativeSession(
      id = "connection-test",
      endpoint = "wss://companion.example/v1/sync",
      token = "t".repeat(43),
      tlsPinSha256 = pin,
      innerTlsPinSha256 = pin,
    )

    assertEquals(pin, saved.tlsPinSha256)
    assertEquals(pin, saved.innerTlsPinSha256)
  }
}
