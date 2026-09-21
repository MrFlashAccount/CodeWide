package dev.codewide.app.rendering

/** Selects stable draw deadlines without quantizing just below a display refresh boundary. */
internal class VoiceAuraFramePacer(
  private val intervalNanos: Long = DEFAULT_INTERVAL_NANOS,
) {
  private val deadlineToleranceNanos = minOf(MAX_DEADLINE_TOLERANCE_NANOS, intervalNanos / 8L)
  private var lastFrameNanos = Long.MIN_VALUE
  private var nextDrawNanos = Long.MIN_VALUE

  init {
    require(intervalNanos > 0L) { "Aura frame interval must be positive" }
  }

  fun shouldDraw(frameTimeNanos: Long): Boolean {
    val previousFrame = lastFrameNanos
    if (previousFrame == Long.MIN_VALUE || frameTimeNanos < previousFrame) {
      lastFrameNanos = frameTimeNanos
      nextDrawNanos = frameTimeNanos + intervalNanos
      return true
    }
    lastFrameNanos = frameTimeNanos

    val deadline = nextDrawNanos
    if (frameTimeNanos + deadlineToleranceNanos < deadline) return false

    val elapsedIntervals = if (frameTimeNanos < deadline) {
      1L
    } else {
      (frameTimeNanos - deadline) / intervalNanos + 1L
    }
    nextDrawNanos = deadline + elapsedIntervals * intervalNanos
    return true
  }

  fun reset() {
    lastFrameNanos = Long.MIN_VALUE
    nextDrawNanos = Long.MIN_VALUE
  }

  private companion object {
    const val MAX_DEADLINE_TOLERANCE_NANOS = 1_000_000L
    // Ambient motion stays at 30 fps. The overlay owner uses a separate 60 fps pacer only while
    // the bounded launch/release wave owns the full-window content effect.
    const val DEFAULT_INTERVAL_NANOS = 33_333_334L
  }
}
