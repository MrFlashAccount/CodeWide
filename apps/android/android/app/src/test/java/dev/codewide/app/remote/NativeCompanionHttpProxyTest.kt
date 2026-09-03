package dev.codewide.app.remote

import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCompanionHttpProxyTest {
  private val capability = "a".repeat(43)

  @Test
  fun `rewrites the loopback host for every upstream request`() {
    val first = HttpRequestHeader.parse(
      "HEAD /$capability/v1/files/upload HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nAuthorization: Bearer one\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    ).authorize(capability)
    val second = HttpRequestHeader.parse(
      "PUT /$capability/v1/files/upload HTTP/1.1\r\nhost: 127.0.0.1:38123\r\nContent-Length: 4\r\nAuthorization: Bearer two\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    ).authorize(capability)

    val firstText = first.withAuthority("companion.example:9443").toString(StandardCharsets.ISO_8859_1)
    val secondText = second.withAuthority("companion.example:9443").toString(StandardCharsets.ISO_8859_1)

    assertTrue(firstText.contains("Host: companion.example:9443\r\n"))
    assertTrue(secondText.contains("host: companion.example:9443\r\n"))
    assertFalse(firstText.contains("127.0.0.1"))
    assertFalse(secondText.contains("127.0.0.1"))
    assertFalse(firstText.contains(capability))
    assertFalse(secondText.contains(capability))
    assertTrue(firstText.startsWith("HEAD /v1/files/upload HTTP/1.1\r\n"))
    assertTrue(firstText.contains("Authorization: Bearer one\r\n"))
    assertTrue(secondText.contains("Authorization: Bearer two\r\n"))
    assertEquals(4L, second.contentLength)
  }

  @Test
  fun `keeps browser origin visible to companion authorization`() {
    val request = HttpRequestHeader.parse(
      "POST /$capability/v1/files/upload HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nOrigin: http://untrusted.example\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    ).authorize(capability)

    val rewritten = request.withAuthority("companion.example").toString(StandardCharsets.ISO_8859_1)

    assertTrue(rewritten.contains("Origin: http://untrusted.example\r\n"))
    assertTrue(request.chunked)
    assertFalse(request.close)
    assertFalse(request.upgrade)
  }

  @Test
  fun `preserves websocket upgrade semantics`() {
    val request = HttpRequestHeader.parse(
      "GET /$capability/v1/tunnels/id HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nConnection: keep-alive, Upgrade\r\nUpgrade: websocket\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    ).authorize(capability)

    assertTrue(request.upgrade)
  }

  @Test
  fun `rejects requests without the exact loopback capability before rewriting`() {
    val missing = HttpRequestHeader.parse(
      "GET /v1/files/preview HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )
    val prefixCollision = HttpRequestHeader.parse(
      "GET /${capability}x/v1/files/preview HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )

    org.junit.Assert.assertThrows(IllegalStateException::class.java) { missing.authorize(capability) }
    org.junit.Assert.assertThrows(IllegalStateException::class.java) { prefixCollision.authorize(capability) }
  }

  @Test
  fun `rejects ambiguous and oversized local request bodies`() {
    val ambiguous =
      "POST /$capability/v2/attachments HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n"
    val oversized =
      "PUT /$capability/v2/attachments HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\nContent-Length: 536870913\r\n\r\n"

    org.junit.Assert.assertThrows(IllegalStateException::class.java) {
      HttpRequestHeader.parse(ambiguous.toByteArray(StandardCharsets.ISO_8859_1))
    }
    org.junit.Assert.assertThrows(IllegalStateException::class.java) {
      HttpRequestHeader.parse(oversized.toByteArray(StandardCharsets.ISO_8859_1))
    }
  }

  @Test
  fun `authority revocation closes active and late proxy sockets`() {
    val lifetime = NativeProxySocketLifetime()
    val active = Socket()
    val late = Socket()

    assertTrue(lifetime.register(active))
    lifetime.close()

    assertTrue(active.isClosed)
    assertFalse(lifetime.register(late))
    assertTrue(late.isClosed)
  }

  @Test
  fun `socket registration racing revocation cannot escape closure`() {
    repeat(100) {
      val lifetime = NativeProxySocketLifetime()
      val socket = Socket()
      val start = CountDownLatch(1)
      val registered = Thread {
        start.await(2, TimeUnit.SECONDS)
        lifetime.register(socket)
      }
      val revoked = Thread {
        start.await(2, TimeUnit.SECONDS)
        lifetime.close()
      }

      registered.start()
      revoked.start()
      start.countDown()
      registered.join(2_000)
      revoked.join(2_000)

      assertFalse(registered.isAlive)
      assertFalse(revoked.isAlive)
      assertTrue(socket.isClosed)
    }
  }
}
