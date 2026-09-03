package dev.codewide.app.remote

/** Atomically bounds both opening and connected duplex channels owned by one lease. */
internal class LeaseChannelGate<T>(
  private val maximum: Int,
  private val onReserved: () -> Unit = {},
  private val onReleased: () -> Unit = {},
) {
  internal class Reservation internal constructor(
    val channelId: String,
    internal val token: Any,
  )

  private data class Slot<T>(
    val reservation: Reservation,
    var channel: T?,
  )

  private val lock = Any()
  private val channels = mutableMapOf<String, Slot<T>>()
  private var released = false

  fun reserve(channelId: String): Reservation = synchronized(lock) {
    check(!released) { "Authenticated lease is released" }
    check(channels.size < maximum) { "Too many authenticated channels are open" }
    check(!channels.containsKey(channelId)) { "Authenticated channel already exists" }
    onReserved()
    val reservation = Reservation(channelId, Any())
    channels[channelId] = Slot(reservation, null)
    reservation
  }

  fun attach(reservation: Reservation, channel: T): Boolean = synchronized(lock) {
    val slot = channels[reservation.channelId]
    if (released || slot?.reservation?.token !== reservation.token) return@synchronized false
    if (slot.channel != null) return@synchronized slot.channel === channel
    slot.channel = channel
    return@synchronized true
  }

  fun get(channelId: String): T? = synchronized(lock) { channels[channelId]?.channel }

  fun contains(reservation: Reservation): Boolean = synchronized(lock) {
    channels[reservation.channelId]?.reservation?.token === reservation.token
  }

  fun owns(reservation: Reservation, channel: T): Boolean = synchronized(lock) {
    val slot = channels[reservation.channelId]
    slot?.reservation?.token === reservation.token && slot.channel === channel
  }

  fun discard(reservation: Reservation): Boolean = synchronized(lock) {
    val slot = channels[reservation.channelId]
    if (slot?.reservation?.token !== reservation.token) return@synchronized false
    channels.remove(reservation.channelId)
    onReleased()
    true
  }

  fun take(channelId: String): T? = synchronized(lock) {
    val slot = channels.remove(channelId) ?: return@synchronized null
    onReleased()
    slot.channel
  }

  fun release(): List<T> = synchronized(lock) {
    released = true
    val connected = channels.values.mapNotNull { it.channel }
    val releasedCount = channels.size
    channels.clear()
    repeat(releasedCount) { onReleased() }
    connected
  }

  fun size(): Int = synchronized(lock) { channels.size }
}
