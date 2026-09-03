package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class V2HeadlessReconnectPolicyTest {
  @Test
  fun airplaneModeDoesNotRetryOrConsumeBackoffForSeveralServers() {
    val policy = V2HeadlessReconnectPolicy(baseDelayMs = 1_000L, maxDelayMs = 60_000L, jitterWindowMs = 500L)
    repeat(20) {
      assertNull(policy.nextDelay("server-a", networkAvailable = false))
      assertNull(policy.nextDelay("server-b", networkAvailable = false))
    }

    val serverA = requireNotNull(policy.nextDelay("server-a", networkAvailable = true))
    val serverB = requireNotNull(policy.nextDelay("server-b", networkAvailable = true))
    assertTrue(serverA in 1_000L until 1_500L)
    assertTrue(serverB in 1_000L until 1_500L)
    assertNotEquals(serverA, serverB)
  }

  @Test
  fun reconnectBackoffGrowsAndNetworkWakeResetsIt() {
    val policy = V2HeadlessReconnectPolicy(baseDelayMs = 1_000L, maxDelayMs = 60_000L, jitterWindowMs = 0L)
    assertEquals(1_000L, policy.nextDelay("server", networkAvailable = true))
    assertEquals(2_000L, policy.nextDelay("server", networkAvailable = true))
    assertEquals(4_000L, policy.nextDelay("server", networkAvailable = true))

    policy.resetAll()

    assertEquals(1_000L, policy.nextDelay("server", networkAvailable = true))
  }
}
