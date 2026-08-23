package dev.codewide.app.remote

import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserDevToolsRequestAuthTest {
  @Test
  fun acceptsExactTokenAndRemovesItBeforeForwarding() {
    val header = "GET /devtools/page/abc?foo=bar&codewide_token=secret HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
    val result = BrowserDevToolsRequestAuth.authenticateAndStrip(header.bytes(), "secret")

    assertEquals(
      "GET /devtools/page/abc?foo=bar HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      result?.toString(StandardCharsets.ISO_8859_1),
    )
  }

  @Test
  fun rejectsMissingOrWrongTokens() {
    val missing = "GET /json/list HTTP/1.1\r\nHost: localhost\r\n\r\n"
    val wrong = "GET /json/list?codewide_token=wrong HTTP/1.1\r\nHost: localhost\r\n\r\n"

    assertNull(BrowserDevToolsRequestAuth.authenticateAndStrip(missing.bytes(), "secret"))
    assertNull(BrowserDevToolsRequestAuth.authenticateAndStrip(wrong.bytes(), "secret"))
  }

  @Test
  fun removesOriginFromChromiumWebSocketHandshake() {
    val header = "GET /devtools/page/abc?codewide_token=secret HTTP/1.1\r\n" +
      "Host: 127.0.0.1:38685\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: <websocket-key>\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Origin: http://127.0.0.1:38685\r\n\r\n"
    val result = BrowserDevToolsRequestAuth.authenticateAndStrip(header.bytes(), "secret")

    assertEquals(
      "GET /devtools/page/abc HTTP/1.1\r\n" +
        "Host: 127.0.0.1:38685\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: <websocket-key>\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
      result?.toString(StandardCharsets.ISO_8859_1),
    )
  }

  @Test
  fun servesBundledFrontendOnlyBelowTheTokenizedLoopbackRoute() {
    val get = BrowserDevToolsAssetRequest.resolve(
      "GET /browser-devtools/secret/front_end/inspector.html?ws=target HTTP/1.1\r\n\r\n".bytes(),
      "secret",
    )
    val head = BrowserDevToolsAssetRequest.resolve(
      "HEAD /browser-devtools/secret/front_end/entrypoints/inspector/inspector.js HTTP/1.1\r\n\r\n".bytes(),
      "secret",
    )

    assertTrue(get is BrowserDevToolsAssetResolution.Asset)
    assertEquals("browser-devtools/front_end/inspector.html", (get as BrowserDevToolsAssetResolution.Asset).path)
    assertFalse(get.headOnly)
    assertTrue(head is BrowserDevToolsAssetResolution.Asset)
    assertTrue((head as BrowserDevToolsAssetResolution.Asset).headOnly)
  }

  @Test
  fun rejectsWrongTokensUnsafePathsAndUnsupportedMethods() {
    val requests = listOf(
      "GET /browser-devtools/wrong/front_end/inspector.html HTTP/1.1\r\n\r\n",
      "GET /browser-devtools/secret/front_end/../secret.txt HTTP/1.1\r\n\r\n",
      "GET /browser-devtools/secret/front_end/%2e%2e/secret.txt HTTP/1.1\r\n\r\n",
      "POST /browser-devtools/secret/front_end/inspector.html HTTP/1.1\r\n\r\n",
    )

    requests.forEach { request ->
      assertEquals(BrowserDevToolsAssetResolution.Forbidden, BrowserDevToolsAssetRequest.resolve(request.bytes(), "secret"))
    }
  }

  @Test
  fun leavesCdpRequestsForTheAuthenticatedSocketProxy() {
    val result = BrowserDevToolsAssetRequest.resolve(
      "GET /json/list?codewide_token=secret HTTP/1.1\r\n\r\n".bytes(),
      "secret",
    )

    assertEquals(BrowserDevToolsAssetResolution.NotAsset, result)
  }

  private fun String.bytes(): ByteArray = toByteArray(StandardCharsets.ISO_8859_1)
}
