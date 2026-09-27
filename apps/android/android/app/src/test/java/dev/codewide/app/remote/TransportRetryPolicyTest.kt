package dev.codewide.app.remote

import org.junit.Assert.*
import org.junit.Test

class TransportRetryPolicyTest {
  @Test fun jitterGrowsToThirtySecondsAndShortConnectionsCannotResetIt() {
    val policy = TransportRetryPolicy { 0.5 }
    assertEquals(listOf(250L, 500L, 1_000L, 2_000L, 4_000L, 8_000L, 15_000L, 15_000L),
      (0..7).map { policy.nextDelayMs(it.toLong()) })
    policy.observeRpc(true, 100L)
    policy.observeRpc(false, 10_099L)
    assertEquals(15_000L, policy.nextDelayMs(10_100L))
  }

  @Test fun onlyTenSecondsOfRpcReadinessResetTheFailureEpisode() {
    val policy = TransportRetryPolicy { 1.0 }
    repeat(4) { policy.nextDelayMs(0L) }
    policy.observeRpc(true, 1_000L)
    policy.observeRpc(true, 6_000L)
    policy.observeRpc(false, 11_000L)
    assertEquals(500L, policy.nextDelayMs(11_001L))
    assertEquals(1_000L, policy.nextDelayMs(11_002L))
  }
}
