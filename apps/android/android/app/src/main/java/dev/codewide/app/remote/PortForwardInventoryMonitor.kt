package dev.codewide.app.remote

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Inventory polling follows connection lifetime, not whether the Ports UI is mounted. */
internal class PortForwardInventoryMonitor(private val discover: (String) -> Unit) {
  private val executor = Executors.newScheduledThreadPool(2) { runnable ->
    Thread(runnable, "CodeWidePortInventory").apply { isDaemon = true }
  }
  private val tasks = mutableMapOf<String, ScheduledFuture<*>>()

  @Synchronized
  fun start(connectionId: String) {
    if (executor.isShutdown || tasks.containsKey(connectionId)) return
    tasks[connectionId] = executor.scheduleWithFixedDelay({
      // Failed scans are not empty inventories; the next successful scan owns
      // reconciliation. The foreground discovery request surfaces its error.
      runCatching { discover(connectionId) }
    }, 0, 5, TimeUnit.SECONDS)
  }

  @Synchronized
  fun stop(connectionId: String) {
    tasks.remove(connectionId)?.cancel(false)
  }

  @Synchronized
  fun close() {
    tasks.values.forEach { it.cancel(false) }
    tasks.clear()
    executor.shutdown()
  }
}
