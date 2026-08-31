package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean

class AuthenticatedTransportLeaseTest {
  @Test
  fun `authenticated HTTP requests use the inner TLS HTTPS origin for websocket endpoints`() {
    assertEquals(
      "https://127.0.0.1:43123/",
      authenticatedRequestBase("ws://127.0.0.1:43123/v1/sync?ignored=true").toString(),
    )
    assertEquals(
      "https://companion.example/",
      authenticatedRequestBase("wss://companion.example/v1/sync").toString(),
    )
  }

  @Test
  fun `request gate bounds every reserved request including authorization`() {
    val gate = LeaseRequestGate<String>(2)
    gate.reserve("first")
    gate.reserve("second")
    assertEquals(2, gate.size())
    assertThrows(IllegalStateException::class.java) { gate.reserve("third") }
    gate.complete("first")
    gate.reserve("third")
    assertEquals(2, gate.size())
  }

  @Test
  fun `release racing attachment either rejects it or returns it for cancellation`() {
    repeat(100) { iteration ->
      val gate = LeaseRequestGate<String>(1)
      val requestId = "request-$iteration"
      val request = "call-$iteration"
      gate.reserve(requestId)
      val start = CountDownLatch(1)
      val attached = AtomicBoolean(false)
      var cancelled = emptyList<String>()
      val attachment = Thread {
        start.await()
        attached.set(gate.attach(requestId, request))
      }
      val release = Thread {
        start.await()
        cancelled = gate.release()
      }
      attachment.start()
      release.start()
      start.countDown()
      attachment.join()
      release.join()

      if (attached.get()) assertEquals(listOf(request), cancelled)
      else assertTrue(cancelled.isEmpty())
      assertFalse(gate.attach(requestId, request))
      assertThrows(IllegalStateException::class.java) { gate.reserve("late") }
    }
  }
}
