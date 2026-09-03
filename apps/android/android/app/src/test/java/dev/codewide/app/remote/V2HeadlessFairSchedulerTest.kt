package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class V2HeadlessFairSchedulerTest {
  @Test
  fun moreThanSixtyFourServersEventuallyRotateThroughBoundedSlots() {
    val scheduler = V2HeadlessFairScheduler(maximumActive = 63)
    val servers = (0..65).map { "server-$it" }
    val admitted = mutableSetOf<String>()

    servers.forEach { server ->
      scheduler.enqueue(server)
      if (scheduler.canAdmit()) {
        val candidate = requireNotNull(scheduler.nextWaiting())
        scheduler.admitted(candidate)
        admitted.add(candidate)
      }
    }

    assertEquals(63, admitted.size)
    assertTrue("server-63" !in admitted)
    assertTrue("server-64" !in admitted)

    repeat(3) { index ->
      val rotation = requireNotNull(scheduler.nextRotation())
      assertEquals("server-$index", rotation.retiringServerId)
      assertEquals("server-${63 + index}", rotation.waitingServerId)
      scheduler.remove(rotation.retiringServerId)
      scheduler.enqueue(rotation.retiringServerId)
      scheduler.admitted(rotation.waitingServerId)
      admitted.add(rotation.waitingServerId)
    }

    assertEquals(servers.toSet(), admitted)

    val nextRotation = requireNotNull(scheduler.nextRotation())
    assertEquals("server-3", nextRotation.retiringServerId)
    assertEquals("server-0", nextRotation.waitingServerId)
  }

  @Test
  fun externalCapacityPressureStillRotatesAnActiveHeadlessServer() {
    val scheduler = V2HeadlessFairScheduler(maximumActive = 64)
    repeat(12) { index ->
      val server = "server-$index"
      scheduler.enqueue(server)
      scheduler.admitted(server)
    }
    scheduler.enqueue("waiting-server")

    assertTrue(scheduler.canAdmit())
    scheduler.markCapacityBlocked()

    val rotation = requireNotNull(scheduler.nextRotation())
    assertEquals("server-0", rotation.retiringServerId)
    assertEquals("waiting-server", rotation.waitingServerId)
  }
}
