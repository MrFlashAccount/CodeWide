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
  fun `process capacity cannot be bypassed with many small leases`() {
    val capacity = AuthenticatedTransportCapacity(
      maximumLeases = 2,
      maximumChannels = 2,
      maximumRequests = 2,
    )
    capacity.reserveLease()
    capacity.reserveLease()
    assertThrows(IllegalStateException::class.java) { capacity.reserveLease() }
    assertEquals(0, capacity.availableLeases())

    val firstChannels = capacity.channelGate<String>(2)
    val secondChannels = capacity.channelGate<String>(2)
    val first = firstChannels.reserve("first")
    secondChannels.reserve("second")
    assertThrows(IllegalStateException::class.java) { firstChannels.reserve("third") }
    assertEquals(0, capacity.availableChannels())
    assertTrue(firstChannels.discard(first))
    firstChannels.reserve("replacement")
    firstChannels.release()
    secondChannels.release()
    assertEquals(2, capacity.availableChannels())

    val firstRequests = capacity.requestGate<String>(2)
    val secondRequests = capacity.requestGate<String>(2)
    firstRequests.reserve("first")
    secondRequests.reserve("second")
    assertThrows(IllegalStateException::class.java) { firstRequests.reserve("third") }
    firstRequests.complete("first")
    firstRequests.complete("first")
    secondRequests.release()
    assertEquals(2, capacity.availableRequests())

    capacity.releaseLease()
    capacity.releaseLease()
    assertEquals(2, capacity.availableLeases())
  }

  @Test
  fun `React context acquisition flood counts pending handles and cleanup closes active ones`() {
    val gate = LeaseAcquisitionGate(2)
    val first = gate.reserve()
    val second = gate.reserve()
    assertThrows(IllegalStateException::class.java) { gate.reserve() }
    assertEquals(2, gate.size())

    assertTrue(gate.attach(first, "lease-one"))
    assertTrue(gate.discard(second))
    val replacement = gate.reserve()
    assertTrue(gate.attach(replacement, "lease-two"))
    assertTrue(gate.owns("lease-one"))

    assertEquals(setOf("lease-one", "lease-two"), gate.close().toSet())
    assertFalse(gate.owns("lease-one"))
    assertThrows(IllegalStateException::class.java) { gate.reserve() }
  }

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
  fun `bounded asset reads produce one safe byte range`() {
    assertEquals("bytes=0-2097152", boundedByteRange(0, 2 * 1024 * 1024 + 1))
    assertEquals("bytes=42-42", boundedByteRange(42, 1))
    assertThrows(IllegalArgumentException::class.java) { boundedByteRange(-1, 1) }
    assertThrows(IllegalArgumentException::class.java) {
      boundedByteRange(0, MAX_AUTHENTICATED_RESPONSE_BYTES + 1)
    }
    assertThrows(ArithmeticException::class.java) { boundedByteRange(Long.MAX_VALUE, 2) }
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
  fun `channel gate bounds pending opens before sockets attach`() {
    val gate = LeaseChannelGate<String>(2)
    val first = gate.reserve("first")
    gate.reserve("second")

    assertEquals(2, gate.size())
    assertThrows(IllegalStateException::class.java) { gate.reserve("third") }
    assertTrue(gate.attach(first, "socket-one"))
    assertEquals("socket-one", gate.get("first"))
    assertEquals(2, gate.size())
  }

  @Test
  fun `channel release rejects pending attachment and returns connected sockets`() {
    val gate = LeaseChannelGate<String>(2)
    val opening = gate.reserve("opening")
    val connected = gate.reserve("connected")
    assertTrue(gate.attach(connected, "socket"))

    assertEquals(listOf("socket"), gate.release())
    assertFalse(gate.attach(opening, "late-socket"))
    assertThrows(IllegalStateException::class.java) { gate.reserve("late") }
  }

  @Test
  fun `stale callback cannot attach to a replacement channel with the same id`() {
    val gate = LeaseChannelGate<String>(1)
    val stale = gate.reserve("same")
    assertTrue(gate.discard(stale))
    val current = gate.reserve("same")

    assertFalse(gate.attach(stale, "stale-socket"))
    assertTrue(gate.attach(current, "current-socket"))
    assertEquals("current-socket", gate.get("same"))
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
