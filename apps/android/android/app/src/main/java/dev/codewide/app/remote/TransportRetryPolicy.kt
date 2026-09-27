package dev.codewide.app.remote

/** Per-WebSocket failure episode; opening TCP alone cannot reset its backoff. */
internal class TransportRetryPolicy(private val random: () -> Double = { Math.random() }) {
  @Volatile var attempts: Int = 0
    private set
  private var liveSince: Long? = null

  @Synchronized fun observeRpc(available: Boolean, nowMs: Long) {
    if (!available) {
      resetIfStable(nowMs)
      liveSince = null
    } else if (liveSince == null) {
      liveSince = nowMs
    }
  }

  @Synchronized fun nextDelayMs(nowMs: Long): Long {
    resetIfStable(nowMs)
    val ceiling = minOf(30_000L, 500L * (1L shl minOf(attempts, 6)))
    attempts = minOf(attempts + 1, 7)
    return (random().coerceIn(0.0, 1.0) * ceiling).toLong()
  }

  @Synchronized fun reset() {
    attempts = 0
    liveSince = null
  }

  private fun resetIfStable(nowMs: Long) {
    val since = liveSince ?: return
    if (nowMs - since >= 10_000L) attempts = 0
  }
}
