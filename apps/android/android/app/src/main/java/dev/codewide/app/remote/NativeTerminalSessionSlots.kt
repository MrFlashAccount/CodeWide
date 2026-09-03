package dev.codewide.app.remote

import java.util.concurrent.ConcurrentHashMap

/** Atomically enforces the process-wide capacity of legacy terminal sessions. */
internal class NativeTerminalSessionSlots<T>(private val capacity: Int) {
  private val entries = ConcurrentHashMap<String, T>()
  private var accepting = true

  val keys: Set<String>
    get() = entries.keys

  val values: Collection<T>
    get() = entries.values

  operator fun get(id: String): T? = entries[id]

  @Synchronized
  fun allocate(id: String, create: () -> T): T? {
    check(accepting) { "Legacy terminal runtime is inactive" }
    val existing = entries[id]
    if (existing != null) return existing
    require(entries.size < capacity) { "Too many terminal sessions are open" }
    entries[id] = create()
    return null
  }

  fun remove(id: String): T? = entries.remove(id)

  @Synchronized
  fun activate() {
    accepting = true
  }

  @Synchronized
  fun deactivate(): List<String> {
    accepting = false
    return entries.keys.toList()
  }
}
