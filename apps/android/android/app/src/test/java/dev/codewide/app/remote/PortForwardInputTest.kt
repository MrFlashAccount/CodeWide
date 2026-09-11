package dev.codewide.app.remote

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PortForwardInputTest {
  @Test
  fun rootRelativeRequestsOnSeparateConnectionsNeedNoLocalKey() {
    for (path in listOf("/", "/api/session?cursor=3", "/assets/main.js")) {
      val request = "GET $path HTTP/1.1\r\nHost: 127.0.0.1:43000\r\n\r\n".toByteArray()
      assertArrayEquals(request, forwarded(request))
    }
  }

  @Test
  fun preservesPostBodyAndApplicationAuthorizationAcrossShortReads() {
    val request = ("POST /api/message HTTP/1.1\r\nHost: localhost\r\n" +
      "Authorization: Bearer test-application-token\r\nContent-Length: 5\r\n\r\nhello").toByteArray()
    val input = object : ByteArrayInputStream(request) {
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        super.read(buffer, offset, minOf(length, 3))
    }
    val output = ByteArrayOutputStream()
    copyPortForwardInput(input) { buffer, count -> output.write(buffer, 0, count); true }
    assertArrayEquals(request, output.toByteArray())
  }

  @Test
  fun preservesWebSocketUpgradeAndFollowingBinaryFrames() {
    val nonce = Base64.getEncoder().encodeToString(ByteArray(16))
    val handshake = ("GET /socket HTTP/1.1\r\nHost: localhost\r\n" +
      "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: $nonce\r\n\r\n").toByteArray()
    val frame = byteArrayOf(0x82.toByte(), 0x82.toByte(), 1, 2, 3, 4, 0, 0xff.toByte())
    val request = handshake + frame
    assertArrayEquals(request, forwarded(request))
  }

  @Test
  fun streamsLargeBinaryUploadsWithoutInterpretingOrDroppingBytes() {
    val bytes = ByteArray(200_000) { (it % 256).toByte() }
    assertArrayEquals(bytes, forwarded(bytes))
  }

  @Test
  fun stopsReadingWhenTheUpstreamRejectsASend() {
    val input = ByteArrayInputStream(ByteArray(200_000))
    var consumed = 0
    var sends = 0
    copyPortForwardInput(input) { _, count -> consumed += count; sends += 1; false }
    assertEquals(1, sends)
    assertEquals(200_000 - consumed, input.available())
  }

  private fun forwarded(bytes: ByteArray): ByteArray {
    val output = ByteArrayOutputStream()
    copyPortForwardInput(ByteArrayInputStream(bytes)) { buffer, count ->
      output.write(buffer, 0, count)
      true
    }
    return output.toByteArray()
  }
}
