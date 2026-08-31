package dev.codewide.app.remote

/** Atomic bounded ownership gate for asynchronous requests attached to one lease. */
internal class LeaseRequestGate<T>(private val maximum: Int) {
  private val lock = Any()
  private val requests = mutableMapOf<String, T?>()
  private var released = false

  fun reserve(requestId: String) {
    synchronized(lock) {
      check(!released) { "Authenticated lease is released" }
      check(requests.size < maximum) { "Too many authenticated requests are open" }
      check(!requests.containsKey(requestId)) { "Authenticated request already exists" }
      requests[requestId] = null
    }
  }

  fun attach(requestId: String, request: T): Boolean = synchronized(lock) {
    if (released || !requests.containsKey(requestId)) return@synchronized false
    requests[requestId] = request
    true
  }

  fun complete(requestId: String, request: T? = null) {
    synchronized(lock) {
      if (request === null || requests[requestId] === request) requests.remove(requestId)
    }
  }

  fun release(): List<T> = synchronized(lock) {
    released = true
    val active = requests.values.filterNotNull()
    requests.clear()
    active
  }

  fun size(): Int = synchronized(lock) { requests.size }
}
