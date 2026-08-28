package dev.codewide.app.remote

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PinnedTlsTest {
  @Test
  fun `wss carrier accepts platform trust while companion identity pins stay exact`() {
    val pin = "sha256/${"A".repeat(43)}="
    assertEquals("wss", PinnedTls.requireTransport("wss://companion.example/v1/sync", pin).scheme)
    assertEquals("wss", PinnedTls.requireTransport("wss://relay.example/v1/sync", null).scheme)
    assertThrows(IllegalArgumentException::class.java) {
      PinnedTls.requireTransport("wss://companion.example/v1/sync", "sha256/not-a-pin")
    }
  }

  @Test
  fun `cleartext carrier remains loopback-only while inner identity may be pinned`() {
    assertEquals("ws", PinnedTls.requireTransport("ws://10.0.2.2:8766/v1/sync", null).scheme)
    assertEquals("ws", PinnedTls.requireTransport("ws://127.0.0.1:8766/v1/sync", "sha256/${"A".repeat(43)}=").scheme)
    assertThrows(IllegalArgumentException::class.java) {
      PinnedTls.requireTransport("ws://remote.example/v1/sync", null)
    }
  }

  @Test
  fun `spki pin uses okhttp compatible sha256 base64`() {
    val spki = "companion-public-key".toByteArray()
    val expected = java.util.Base64.getEncoder().encodeToString(
      MessageDigest.getInstance("SHA-256").digest(spki),
    )
    assertEquals("sha256/$expected", PinnedTls.pinForSpki(spki))
  }

  @Test
  fun `every profile route is rewritten through inner tls`() {
    val saved = StoredNativeSession(
      id = "server",
      endpoint = "ws://relay.example:8080/v1/sync",
      token = "x".repeat(32),
      tlsPinSha256 = null,
      innerTlsPinSha256 = "sha256/${"A".repeat(43)}=",
    )
    assertEquals("wss://relay.example:8080/v1/sync", InnerTlsTransport.url(saved, saved.endpoint))
    assertEquals(
      "https://relay.example:8080/v1/files/download?path=one",
      InnerTlsTransport.url(saved, "http://relay.example:8080/v1/files/download?path=one"),
    )
  }

  @Test
  fun `ordinary config saves cannot downgrade an upgraded identity`() {
    val pin = "sha256/${"A".repeat(43)}="
    val deviceId = "device-${"a".repeat(64)}"
    val required = StoredNativeSession(
      id = "server",
      endpoint = "wss://relay-one.example/v1/sync",
      token = "x".repeat(32),
      tlsPinSha256 = null,
      innerTlsPinSha256 = pin,
      deviceId = deviceId,
    )
    val moved = mergeNativeSessionCredentials(
      required,
      required.id,
      "wss://relay-two.example/v1/sync",
      required.token,
      null,
      true,
    )
    assertEquals(pin, moved.innerTlsPinSha256)
    assertEquals(deviceId, moved.deviceId)

    val rotatedCapability = mergeNativeSessionCredentials(
      moved,
      moved.id,
      moved.endpoint,
      "y".repeat(32),
      null,
      true,
    )
    assertEquals(pin, rotatedCapability.innerTlsPinSha256)
    assertEquals(deviceId, rotatedCapability.deviceId)
  }

  @Test
  fun `new credentials require and persist an identity pin`() {
    val pin = "sha256/${"A".repeat(43)}="
    val deviceId = "device-${"b".repeat(64)}"
    val paired = mergeNativeSessionCredentials(
      null,
      "server",
      "wss://relay.example/v1/sync",
      "x".repeat(32),
      pin,
      true,
      deviceId,
    )
    assertEquals(pin, paired.innerTlsPinSha256)
    assertEquals(deviceId, paired.deviceId)
    assertThrows(IllegalArgumentException::class.java) {
      mergeNativeSessionCredentials(null, "legacy", "wss://relay.example/v1/sync", "x".repeat(32), null, true)
    }
  }
}
