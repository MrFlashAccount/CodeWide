package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class V2AuthenticatedLeaseAdmissionTest {
  @Test
  fun fullProcessCapacityPreemptsOldestHeadlessLeaseAndRetriesExplicitLease() {
    val scheduler = V2HeadlessFairScheduler(maximumActive = 63)
    repeat(63) { index ->
      val server = "server-$index"
      scheduler.enqueue(server)
      scheduler.admitted(server)
    }
    var processCapacityAvailable = false
    var acquireAttempts = 0
    val stopped = mutableListOf<String>()
    var fairnessScheduled = false
    val admission = V2AuthenticatedLeaseAdmission(
      scheduler,
      acquire = { savedServerId ->
        acquireAttempts += 1
        if (!processCapacityAvailable) throw AuthenticatedLeaseCapacityExceededException()
        "lease:$savedServerId"
      },
      stopHeadless = { savedServerId ->
        stopped.add(savedServerId)
        scheduler.remove(savedServerId)
        processCapacityAvailable = true
      },
      scheduleFairness = { fairnessScheduled = true },
    )

    assertEquals("lease:foreground-server", admission.acquire("foreground-server"))
    assertEquals(2, acquireAttempts)
    assertEquals(listOf("server-0"), stopped)
    assertEquals("server-0", scheduler.nextWaiting())
    assertTrue(fairnessScheduled)
  }

  @Test
  fun nonCapacityFailureDoesNotRetireHeadlessAuthority() {
    val scheduler = V2HeadlessFairScheduler(maximumActive = 63)
    scheduler.enqueue("server-0")
    scheduler.admitted("server-0")
    val stopped = mutableListOf<String>()
    val admission = V2AuthenticatedLeaseAdmission(
      scheduler,
      acquire = { error("invalid credentials") },
      stopHeadless = stopped::add,
      scheduleFairness = {},
    )

    runCatching { admission.acquire("foreground-server") }

    assertTrue(stopped.isEmpty())
    assertEquals("server-0", scheduler.oldestActive())
  }
}
