package dev.codewide.app.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OpusTransportBatcherTest {
  @Test
  fun preservesPacketOrderAndFramesEachPacket() {
    val packed = packOpusPackets(listOf(byteArrayOf(1, 2), byteArrayOf(3, 4, 5)))

    assertArrayEquals(byteArrayOf(0, 2, 1, 2, 0, 3, 3, 4, 5), packed)
  }

  @Test
  fun emitsOnlyAfterTheTargetDurationAndFlushesTheTail() {
    val batcher = OpusTransportBatcher(1_920)

    assertNull(batcher.append(EncodedOpusPacket(byteArrayOf(1), 960), 0.25))
    val full = batcher.append(EncodedOpusPacket(byteArrayOf(2), 960), 0.5)
    assertEquals(1_920, full?.samplesPerChannel)
    assertEquals(0.5, full?.level ?: 0.0, 0.0)
    assertArrayEquals(byteArrayOf(0, 1, 1, 0, 1, 2), full?.data)

    assertNull(batcher.flush())
    assertNull(batcher.append(EncodedOpusPacket(byteArrayOf(3), 960), 0.75))
    val tail = batcher.flush()
    assertEquals(960, tail?.samplesPerChannel)
    assertEquals(0.75, tail?.level ?: 0.0, 0.0)
  }
}
