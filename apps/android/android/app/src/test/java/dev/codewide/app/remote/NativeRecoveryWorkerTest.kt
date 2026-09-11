package dev.codewide.app.remote

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRecoveryWorkerTest {
  @Test
  fun blockedRecoveryDoesNotBlockCallerAndLaterRecoveryPreservesOrder() {
    val worker = NativeRecoveryWorker()
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val executingThread = AtomicReference<Thread>()
    val order = mutableListOf<Int>()
    try {
      assertTrue(worker.submit {
        executingThread.set(Thread.currentThread())
        started.countDown()
        release.await(5, TimeUnit.SECONDS)
        order.add(1)
      })
      assertTrue(started.await(5, TimeUnit.SECONDS))
      assertNotSame(Thread.currentThread(), executingThread.get())
      assertTrue(worker.submit {
        order.add(2)
        finished.countDown()
      })
      assertEquals(1L, finished.count)
      release.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
      assertEquals(listOf(1, 2), order)
    } finally {
      release.countDown()
      worker.close()
    }
  }

  @Test
  fun shutdownDoesNotInterruptAnInFlightTransactionAndRejectsNewWork() {
    val worker = NativeRecoveryWorker()
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val interrupted = AtomicReference(false)
    try {
      worker.submit {
        started.countDown()
        try {
          release.await(5, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
          interrupted.set(true)
        } finally {
          finished.countDown()
        }
      }
      assertTrue(started.await(5, TimeUnit.SECONDS))
      worker.close()
      assertFalse(worker.submit { throw AssertionError("Closed worker executed recovery") })
      release.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
      assertFalse(interrupted.get())
    } finally {
      release.countDown()
      worker.close()
    }
  }
}
