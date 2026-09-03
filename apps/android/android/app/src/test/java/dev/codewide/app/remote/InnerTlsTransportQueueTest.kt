package dev.codewide.app.remote

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class InnerTlsTransportQueueTest {
  @Test
  fun carrierFloodIsByteBoundedAndBecomesTerminalOnOverflow() {
    val queue = TunnelInboundQueue(8)
    assertTrue(queue.offer(ByteArray(4)))
    assertTrue(queue.offer(ByteArray(4)))
    assertFalse(queue.offer(ByteArray(1)))
    assertEquals(8, queue.queuedByteCount())

    val overflow = IOException("Secure tunnel inbound buffer overflow")
    queue.fail(overflow)

    assertTrue(queue.isTerminal())
    assertEquals(0, queue.queuedByteCount())
    val failure = queue.take(0)
    assertTrue(failure is TunnelChunk.Failed)
    assertEquals(overflow, (failure as TunnelChunk.Failed).error)
    assertEquals(overflow, (queue.take(0) as TunnelChunk.Failed).error)
    assertFalse(queue.offer(ByteArray(1)))
  }

  @Test
  fun queueReleasesByteCapacityAsTheConsumerReads() {
    val queue = TunnelInboundQueue(8)
    assertTrue(queue.offer(ByteArray(8)))
    assertTrue(queue.take(0) is TunnelChunk.Bytes)
    assertEquals(0, queue.queuedByteCount())
    assertTrue(queue.offer(ByteArray(8)))
  }

  @Test
  fun tinyFrameFloodIsChunkBoundedBeforeObjectOverheadCanGrowWithoutLimit() {
    val queue = TunnelInboundQueue(maximumBytes = 1_024, maximumChunks = 4)

    repeat(4) { assertTrue(queue.offer(ByteArray(1))) }
    assertFalse(queue.offer(ByteArray(1)))
    assertEquals(4, queue.queuedByteCount())
    assertEquals(4, queue.queuedChunkCount())
  }

  @Test
  fun emptyQueueHonorsSocketReadTimeout() {
    val queue = TunnelInboundQueue(8)
    assertThrows(java.net.SocketTimeoutException::class.java) { queue.take(1) }
  }

  @Test
  fun terminalEndRemainsVisibleToEverySubsequentRead() {
    val queue = TunnelInboundQueue(8)
    queue.end()

    assertEquals(TunnelChunk.End, queue.take(0))
    assertEquals(TunnelChunk.End, queue.take(0))
  }
}
