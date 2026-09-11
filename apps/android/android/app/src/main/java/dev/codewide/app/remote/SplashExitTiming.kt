package dev.codewide.app.remote

internal data class SplashExitTiming(
  val contentToExitMs: Double,
  val animationStartDelayMs: Double,
  val animationDurationMs: Double,
  val applicationEntryToSplashRemovedMs: Double,
  val cancelled: Boolean,
)

/** Monotonic callback timestamps, not the configured animation duration. */
internal class SplashExitTrace(private val requestedAtNanos: Long) {
  private var startedAtNanos = requestedAtNanos

  fun started(atNanos: Long) {
    startedAtNanos = atNanos
  }

  fun finish(contentAtNanos: Long, applicationEntryAtNanos: Long, removedAtNanos: Long, cancelled: Boolean) =
    SplashExitTiming(
      contentToExitMs = milliseconds(contentAtNanos, requestedAtNanos),
      animationStartDelayMs = milliseconds(requestedAtNanos, startedAtNanos),
      animationDurationMs = milliseconds(startedAtNanos, removedAtNanos),
      applicationEntryToSplashRemovedMs = milliseconds(applicationEntryAtNanos, removedAtNanos),
      cancelled = cancelled,
    )

  private fun milliseconds(start: Long, end: Long): Double = maxOf(0L, end - start) / 1_000_000.0
}
