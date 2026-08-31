package dev.codewide.app.remote

import java.util.concurrent.atomic.AtomicBoolean

/** Makes recorder shutdown idempotent across startup failure, explicit stop, and capture-thread exit. */
internal class V2VoiceRecorderLease(
  private val stopAction: () -> Unit,
  private val releaseAction: () -> Unit,
) {
  private val stopped = AtomicBoolean(false)
  private val released = AtomicBoolean(false)

  fun stop() {
    if (!released.get() && stopped.compareAndSet(false, true)) runCatching(stopAction)
  }

  fun release() {
    if (!released.compareAndSet(false, true)) return
    try {
      if (stopped.compareAndSet(false, true)) runCatching(stopAction)
    } finally {
      releaseAction()
    }
  }
}
