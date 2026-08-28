package dev.codewide.app.remote

import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCompanionHttpProxyTest {
  @Test
  fun `rewrites the loopback host for every upstream request`() {
    val first = HttpRequestHeader.parse(
      "HEAD /v1/files/upload HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nAuthorization: Bearer one\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )
    val second = HttpRequestHeader.parse(
      "PUT /v1/files/upload HTTP/1.1\r\nhost: 127.0.0.1:38123\r\nContent-Length: 4\r\nAuthorization: Bearer two\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )

    val firstText = first.withAuthority("companion.example:9443").toString(StandardCharsets.ISO_8859_1)
    val secondText = second.withAuthority("companion.example:9443").toString(StandardCharsets.ISO_8859_1)

    assertTrue(firstText.contains("Host: companion.example:9443\r\n"))
    assertTrue(secondText.contains("host: companion.example:9443\r\n"))
    assertFalse(firstText.contains("127.0.0.1"))
    assertFalse(secondText.contains("127.0.0.1"))
    assertTrue(firstText.contains("Authorization: Bearer one\r\n"))
    assertTrue(secondText.contains("Authorization: Bearer two\r\n"))
    assertEquals(4L, second.contentLength)
  }

  @Test
  fun `keeps browser origin visible to companion authorization`() {
    val request = HttpRequestHeader.parse(
      "POST /v1/files/upload HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nOrigin: http://untrusted.example\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )

    val rewritten = request.withAuthority("companion.example").toString(StandardCharsets.ISO_8859_1)

    assertTrue(rewritten.contains("Origin: http://untrusted.example\r\n"))
    assertTrue(request.chunked)
    assertFalse(request.close)
    assertFalse(request.upgrade)
  }

  @Test
  fun `preserves websocket upgrade semantics`() {
    val request = HttpRequestHeader.parse(
      "GET /v1/tunnels/id HTTP/1.1\r\nHost: 127.0.0.1:38123\r\nConnection: keep-alive, Upgrade\r\nUpgrade: websocket\r\n\r\n"
        .toByteArray(StandardCharsets.ISO_8859_1),
    )

    assertTrue(request.upgrade)
  }
}
