package dev.codewide.app.remote

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PortInventoryWorkerTest {
  @Test
  fun blockedReconciliationDoesNotBlockDeliveryAndCoalescesPendingSnapshots() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val completed = CountDownLatch(1)
    val applied = mutableListOf<String>()
    val worker = PortInventoryWorker { inventory ->
      if (inventory.payload == "first") {
        started.countDown()
        assertTrue(release.await(5, TimeUnit.SECONDS))
      }
      applied.add(inventory.payload)
      if (inventory.payload == "latest") completed.countDown()
    }
    try {
      worker.submit(PendingPortInventory("server", 1, "first"))
      assertTrue(started.await(5, TimeUnit.SECONDS))
      repeat(100) { worker.submit(PendingPortInventory("server", 1, "intermediate-$it")) }
      worker.submit(PendingPortInventory("server", 1, "latest"))
      release.countDown()
      assertTrue(completed.await(5, TimeUnit.SECONDS))
      assertEquals(listOf("first", "latest"), applied)
    } finally {
      release.countDown()
      worker.close()
    }
  }
}
