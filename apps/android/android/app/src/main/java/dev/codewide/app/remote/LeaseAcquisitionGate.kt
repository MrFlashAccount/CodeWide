package dev.codewide.app.remote

/** Bounds pending plus active leases owned by one React context. */
internal class LeaseAcquisitionGate(private val maximum: Int) {
  internal class Reservation internal constructor(internal val token: Any)

  private val lock = Any()
  private val pending = mutableSetOf<Any>()
  private val active = mutableSetOf<String>()
  private var closed = false

  fun reserve(): Reservation = synchronized(lock) {
    check(!closed) { "React context is no longer active" }
    check(pending.size + active.size < maximum) { "Too many authenticated leases are open in this React context" }
    val reservation = Reservation(Any())
    pending += reservation.token
    reservation
  }

  fun attach(reservation: Reservation, handle: String): Boolean = synchronized(lock) {
    if (closed || !pending.remove(reservation.token)) return@synchronized false
    check(active.add(handle)) { "Authenticated lease handle already exists" }
    true
  }

  fun discard(reservation: Reservation): Boolean = synchronized(lock) {
    pending.remove(reservation.token)
  }

  fun owns(handle: String): Boolean = synchronized(lock) { active.contains(handle) }

  fun release(handle: String): Boolean = synchronized(lock) { active.remove(handle) }

  fun close(): List<String> = synchronized(lock) {
    closed = true
    pending.clear()
    active.toList().also { active.clear() }
  }

  fun size(): Int = synchronized(lock) { pending.size + active.size }
}
