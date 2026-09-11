package dev.codewide.app.remote

internal enum class PortForwardIdentityMode(val wireValue: String) {
  MANUAL("manual"),
  DISCOVERED("discovered"),
  ;

  companion object {
    fun fromWireValue(value: String): PortForwardIdentityMode = entries.firstOrNull { it.wireValue == value }
      ?: error("Port forward identity mode is invalid")
  }
}

internal fun portForwardIdentityTransitionAllowed(
  previous: PortForwardIdentityMode?,
  next: PortForwardIdentityMode,
): Boolean = previous != PortForwardIdentityMode.DISCOVERED || next == PortForwardIdentityMode.DISCOVERED

internal data class CurrentPortForward(
  val id: String,
  val connectionId: String,
  val label: String,
  val remotePort: Int,
  val preferredLocalPort: Int?,
  val serviceKey: String?,
  val preference: String,
  val enabled: Boolean,
  val updatedAt: Long,
  val identityMode: PortForwardIdentityMode = if (serviceKey == null) {
    PortForwardIdentityMode.MANUAL
  } else {
    PortForwardIdentityMode.DISCOVERED
  },
)

/** Current inventory profiles only. Recreating the service starts with no ports. */
internal class NativePortForwardStore {
  private val profiles = linkedMapOf<String, CurrentPortForward>()

  fun list(connectionId: String? = null): List<CurrentPortForward> = synchronized(STORE_LOCK) {
    profiles.values.filter { connectionId == null || it.connectionId == connectionId }
  }

  fun get(id: String): CurrentPortForward? = synchronized(STORE_LOCK) {
    profiles[id]
  }

  fun upsert(profile: CurrentPortForward): CurrentPortForward = synchronized(STORE_LOCK) {
    validate(profile)
    if (!profiles.containsKey(profile.id)) require(profiles.size < MAX_PROFILES) { "Too many current port forwards" }
    require(portForwardIdentityTransitionAllowed(profiles[profile.id]?.identityMode, profile.identityMode)) {
      "A discovered port profile cannot be downgraded to manual"
    }
    profiles[profile.id] = profile
    profile
  }

  fun setEnabled(id: String, enabled: Boolean): CurrentPortForward? = synchronized(STORE_LOCK) {
    val current = profiles[id] ?: return@synchronized null
    val updated = current.copy(enabled = enabled, updatedAt = System.currentTimeMillis())
    profiles[id] = updated
    updated
  }

  fun remove(id: String): Boolean = synchronized(STORE_LOCK) {
    profiles.remove(id) != null
  }

  fun removeConnection(connectionId: String) = synchronized(STORE_LOCK) {
    profiles.values.removeAll { it.connectionId == connectionId }
  }

  companion object {
    private val STORE_LOCK = Any()
    private const val MAX_PROFILES = 64

    fun validate(profile: CurrentPortForward) {
      require(profile.id.matches(Regex("^[A-Za-z0-9._:-]{1,128}$"))) { "Port forward id is invalid" }
      require(profile.connectionId.isNotBlank() && profile.connectionId.length <= 160) { "Connection id is invalid" }
      require(profile.label.isNotBlank() && profile.label.length <= 80 && !profile.label.any { it.code < 32 || it.code == 127 }) { "Label is invalid" }
      require(profile.remotePort in 1..65_535) { "Remote port is invalid" }
      require(profile.preferredLocalPort == null || profile.preferredLocalPort in 1..65_535) { "Local port is invalid" }
      require(profile.serviceKey == null || profile.serviceKey.matches(Regex("^[a-f0-9]{64}$"))) { "Service key is invalid" }
      require(
        (profile.identityMode == PortForwardIdentityMode.MANUAL && profile.serviceKey == null) ||
          (profile.identityMode == PortForwardIdentityMode.DISCOVERED && profile.serviceKey != null)
      ) { "Port forward identity does not match its service key" }
      require(profile.preference in setOf("automatic", "included", "excluded")) { "Forwarding preference is invalid" }
    }
  }
}
