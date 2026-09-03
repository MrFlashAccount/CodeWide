package dev.codewide.app.remote

import kotlin.math.min

/** Backoff for service-owned V2 sockets. Offline state never consumes an attempt. */
internal class V2HeadlessReconnectPolicy(
  private val baseDelayMs: Long = 1_000L,
  private val maxDelayMs: Long = 60_000L,
  private val jitterWindowMs: Long = 500L,
) {
  private val attempts = mutableMapOf<String, Int>()

  @Synchronized
  fun nextDelay(savedServerId: String, networkAvailable: Boolean): Long? {
    if (!networkAvailable) return null
    val attempt = attempts[savedServerId] ?: 0
    attempts[savedServerId] = min(attempt + 1, MAX_EXPONENT)
    val exponential = baseDelayMs * (1L shl min(attempt, MAX_EXPONENT))
    return min(maxDelayMs, exponential + stableJitter(savedServerId))
  }

  @Synchronized
  fun reset(savedServerId: String) {
    attempts.remove(savedServerId)
  }

  @Synchronized
  fun resetAll() {
    attempts.clear()
  }

  private fun stableJitter(savedServerId: String): Long {
    if (jitterWindowMs <= 0L) return 0L
    return (savedServerId.hashCode().toLong() and Int.MAX_VALUE.toLong()) % jitterWindowMs
  }

  private companion object {
    const val MAX_EXPONENT = 6
  }
}
