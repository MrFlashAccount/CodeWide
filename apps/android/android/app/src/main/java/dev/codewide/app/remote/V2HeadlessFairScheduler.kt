package dev.codewide.app.remote

/**
 * Fairly shares the bounded native transport capacity between enabled servers.
 *
 * When more servers want a headless subscription than can be kept live, the
 * oldest active server yields to the oldest waiting server. The yielded server
 * joins the back of the queue, so every enabled server is eventually observed.
 */
internal class V2HeadlessFairScheduler(
  private val maximumActive: Int,
) {
  internal data class Rotation(val retiringServerId: String, val waitingServerId: String)

  private val active = LinkedHashSet<String>()
  private val waiting = LinkedHashSet<String>()
  private var capacityBlocked = false

  init {
    require(maximumActive > 0) { "Headless subscription capacity must be positive" }
  }

  @Synchronized
  fun enqueue(savedServerId: String) {
    if (savedServerId !in active) waiting.add(savedServerId)
  }

  @Synchronized
  fun admitted(savedServerId: String) {
    waiting.remove(savedServerId)
    active.add(savedServerId)
    capacityBlocked = false
  }

  @Synchronized
  fun markCapacityBlocked() {
    capacityBlocked = true
  }

  @Synchronized
  fun remove(savedServerId: String) {
    active.remove(savedServerId)
    waiting.remove(savedServerId)
  }

  @Synchronized
  fun canAdmit(): Boolean = active.size < maximumActive

  @Synchronized
  fun nextWaiting(): String? = waiting.firstOrNull()

  @Synchronized
  fun oldestActive(): String? = active.firstOrNull()

  @Synchronized
  fun nextRotation(): Rotation? {
    if (active.size < maximumActive && !capacityBlocked) return null
    val retiring = active.firstOrNull() ?: return null
    val candidate = waiting.firstOrNull() ?: return null
    return Rotation(retiring, candidate)
  }

  @Synchronized
  fun hasWaiting(): Boolean = waiting.isNotEmpty()

  @Synchronized
  fun clear() {
    active.clear()
    waiting.clear()
    capacityBlocked = false
  }
}
