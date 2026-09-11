package dev.codewide.app.remote

import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Serializes service recovery without executing storage or waiting for locks on the UI thread. */
internal class NativeRecoveryWorker : AutoCloseable {
  private val executor = Executors.newSingleThreadExecutor { task ->
    Thread(task, "CodeWideRecovery")
  }

  fun submit(operation: () -> Unit): Boolean = try {
    executor.execute(operation)
    true
  } catch (_: RejectedExecutionException) {
    false
  }

  override fun close() {
    // Do not interrupt a storage transaction. The service checks its destroyed
    // flag before executing any already queued work.
    executor.shutdown()
  }
}
