package dev.codewide.app.remote

import java.util.concurrent.Executors

internal data class PendingPortInventory(val serverId: String, val generation: Long, val payload: String)

/** Latest value per server; network callbacks never wait for parsing or reconciliation. */
internal class PortInventoryWorker(private val apply: (PendingPortInventory) -> Unit) : AutoCloseable {
  private val executor = Executors.newSingleThreadExecutor { task ->
    Thread(task, "CodeWidePortInventoryApply").apply { isDaemon = true }
  }
  private val pending = linkedMapOf<String, PendingPortInventory>()
  private var scheduled = false
  private var closed = false

  fun submit(value: PendingPortInventory) = synchronized(pending) {
    if (closed) return@synchronized
    pending[value.serverId] = value
    if (!scheduled) {
      scheduled = true
      executor.execute(::drain)
    }
  }

  private fun drain() {
    while (true) {
      val value = synchronized(pending) {
        val iterator = pending.values.iterator()
        if (!iterator.hasNext()) {
          scheduled = false
          return
        }
        iterator.next().also { iterator.remove() }
      }
      apply(value)
    }
  }

  override fun close() = synchronized(pending) {
    closed = true
    pending.clear()
    executor.shutdown()
  }
}
