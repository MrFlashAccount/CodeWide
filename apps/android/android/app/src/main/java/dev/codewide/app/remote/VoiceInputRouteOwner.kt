package dev.codewide.app.remote

internal enum class VoiceInputKind(val wire: String) {
  SYSTEM("system"), BUILTIN("builtin"), WIRED("wired"), USB("usb"), BLUETOOTH("bluetooth"), BLE("ble");

  val communication: Boolean get() = this == BLUETOOTH || this == BLE

  companion object {
    fun parse(value: String): VoiceInputKind? = entries.find { it.wire == value }
  }
}

internal data class VoiceInputDevice(val id: Int, val kind: VoiceInputKind, val label: String)

internal interface VoiceInputRoutePlatform {
  fun devices(): List<VoiceInputDevice>
  fun routedInput(): VoiceInputDevice?
  fun preferInput(id: Int?)
  fun communicationRoute(inputId: Int): (() -> Unit)?
  fun muteCapture(muted: Boolean)
}

/** Owns only one Global Voice capture lease; device ids never cross its persistence boundary. */
internal class VoiceInputRouteOwner(
  private val platform: VoiceInputRoutePlatform,
  initialPreference: VoiceInputKind,
  private val savePreference: (VoiceInputKind) -> Unit,
) {
  var preference = initialPreference; private set
  var selected: VoiceInputDevice? = null; private set
  var fallback = "none"; private set
  var active = false; private set
  var muted = true; private set
  private var restoreCommunication: (() -> Unit)? = null
  private var preferredConnectedId: Int? = null

  fun start(initiallyMuted: Boolean) {
    check(!active) { "Global Voice input is already leased" }
    active = true
    muted = initiallyMuted
    try {
      platform.muteCapture(muted)
      resolve(preferredConnectedId)
    } catch (error: RuntimeException) {
      stop()
      throw error
    }
  }

  fun select(kind: VoiceInputKind, connectedId: Int?) {
    if (kind != VoiceInputKind.SYSTEM && connectedId != null) {
      require(platform.devices().any { it.id == connectedId && it.kind == kind }) {
        "The selected microphone is no longer connected"
      }
    }
    savePreference(kind)
    preference = kind
    preferredConnectedId = connectedId
    if (active) resolve(connectedId)
  }

  fun setMuted(next: Boolean) {
    check(active) { "Global Voice input is not leased" }
    platform.muteCapture(next)
    muted = next
  }

  fun devicesChanged() {
    if (!active) return
    val device = selected ?: return
    if (platform.devices().none { it.id == device.id && it.kind == device.kind }) {
      useSystemDefault("unavailable")
    }
  }

  fun verifyRouting() {
    if (!active || muted) return
    val device = selected ?: return
    if (platform.routedInput()?.id != device.id) useSystemDefault("routeRejected")
  }

  fun stop() {
    if (!active) return
    active = false
    selected = null
    fallback = "none"
    try {
      platform.preferInput(null)
    } finally {
      try {
        releaseCommunication()
      } finally {
        platform.muteCapture(false)
      }
    }
  }

  private fun resolve(connectedId: Int?) {
    releaseCommunication()
    selected = null
    fallback = "none"
    if (preference == VoiceInputKind.SYSTEM) {
      platform.preferInput(null)
      return
    }
    val candidates = platform.devices().filter { it.kind == preference }
    val device = candidates.find { it.id == connectedId } ?: candidates.firstOrNull()
    if (device == null) {
      useSystemDefault("unavailable")
      return
    }
    if (device.kind.communication) {
      restoreCommunication = platform.communicationRoute(device.id)
      if (restoreCommunication == null) {
        useSystemDefault("routeRejected")
        return
      }
    }
    try {
      platform.preferInput(device.id)
      selected = device
    } catch (_: RuntimeException) {
      useSystemDefault("routeRejected")
    }
  }

  private fun useSystemDefault(reason: String) {
    selected = null
    fallback = reason
    try {
      platform.preferInput(null)
    } finally {
      releaseCommunication()
    }
  }

  private fun releaseCommunication() {
    val restore = restoreCommunication
    restoreCommunication = null
    restore?.invoke()
  }
}
