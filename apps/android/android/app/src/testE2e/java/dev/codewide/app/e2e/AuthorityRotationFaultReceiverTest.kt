package dev.codewide.app.e2e

import dev.codewide.app.remote.CodexConnectionService
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthorityRotationFaultReceiverTest {
  @Test
  fun acceptsOnlyExplicitAuthorityFaultModes() {
    assertEquals(AuthorityRotationFaultMode.HOLD_NEXT, parseAuthorityRotationFaultMode("hold-next"))
    assertEquals(AuthorityRotationFaultMode.STATUS, parseAuthorityRotationFaultMode("status"))
    assertEquals(AuthorityRotationFaultMode.RELEASE, parseAuthorityRotationFaultMode("release"))
    assertNull(parseAuthorityRotationFaultMode(null))
    assertNull(parseAuthorityRotationFaultMode("retry"))
  }

  @Test
  fun detectsOnlyBlockedRealAuthorityEntrypoints() {
    val monitor = Any()
    val monitorHeld = CountDownLatch(1)
    val releaseMonitor = CountDownLatch(1)
    val blocked = Thread {
      synchronized(monitor) { Unit }
    }
    val holder = Thread {
      synchronized(monitor) {
        monitorHeld.countDown()
        releaseMonitor.await(2, TimeUnit.SECONDS)
      }
    }
    holder.start()
    assertTrue(monitorHeld.await(2, TimeUnit.SECONDS))
    blocked.start()
    waitForBlocked(blocked)

    val unrelated = mapOf(blocked to arrayOf(StackTraceElement("example.Other", "retry", null, 1)))
    val authority = mapOf(
      blocked to arrayOf(
        StackTraceElement(
          CodexConnectionService::class.java.name,
          "replaceSavedServerAuthority",
          null,
          1,
        ),
      ),
    )
    assertFalse(hasBlockedAuthorityTransition(unrelated))
    assertTrue(hasBlockedAuthorityTransition(authority))

    releaseMonitor.countDown()
    holder.join(2_000)
    blocked.join(2_000)
  }

  private fun waitForBlocked(candidate: Thread) {
    repeat(200) {
      if (candidate.state == Thread.State.BLOCKED) return
      Thread.yield()
    }
    error("Test thread did not block")
  }
}
