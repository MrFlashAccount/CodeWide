package dev.codewide.app.remote

/** OS observations only. Validation is not evidence about a particular Companion. */
internal enum class NetworkAvailability(val wireValue: String) {
  UNKNOWN("unknown"),
  ABSENT("noDefaultNetwork"),
  UNVALIDATED("unvalidated"),
  CAPTIVE("captivePortal"),
  VALIDATED("validated"),
  BLOCKED("blocked"),
}

/** Fences late callbacks from the previous default route during Wi-Fi/VPN/cellular handoff. */
internal class DefaultNetworkState<NetworkId> {
  private var current: NetworkId? = null
  private var capabilities = NetworkAvailability.UNKNOWN
  private var blocked = false
  @Volatile var epoch: Long = 0L
    private set
  @Volatile var availability = NetworkAvailability.UNKNOWN
    private set

  val canAttempt: Boolean
    get() = availability != NetworkAvailability.ABSENT && availability != NetworkAvailability.BLOCKED

  fun available(network: NetworkId): Boolean {
    if (current == network) return false
    current = network
    epoch += 1
    capabilities = NetworkAvailability.UNVALIDATED
    blocked = false
    availability = capabilities
    return true
  }

  fun lost(network: NetworkId): Boolean {
    if (current != network) return false
    current = null
    epoch += 1
    availability = NetworkAvailability.ABSENT
    return true
  }

  fun absent() {
    current = null
    availability = NetworkAvailability.ABSENT
  }

  fun capabilities(network: NetworkId, validated: Boolean, captive: Boolean): Boolean {
    if (current != network) return false
    capabilities = when {
      captive -> NetworkAvailability.CAPTIVE
      validated -> NetworkAvailability.VALIDATED
      else -> NetworkAvailability.UNVALIDATED
    }
    return publish()
  }

  fun blocked(network: NetworkId, value: Boolean): Boolean {
    if (current != network) return false
    blocked = value
    return publish()
  }

  private fun publish(): Boolean {
    val next = if (blocked) NetworkAvailability.BLOCKED else capabilities
    if (availability == next) return false
    availability = next
    return true
  }
}
