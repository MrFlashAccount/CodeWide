package dev.codewide.app.rendering

/** Bounds expensive full-screen aura filter replacement without limiting the window refresh rate. */
internal class VoiceAuraFramePacer(
  private val intervalNanos: Long = DEFAULT_INTERVAL_NANOS,
) {
  private var lastDrawNanos = Long.MIN_VALUE

  init {
    require(intervalNanos > 0L) { "Aura frame interval must be positive" }
  }

  fun shouldDraw(frameTimeNanos: Long): Boolean {
    val previous = lastDrawNanos
    if (
      previous == Long.MIN_VALUE ||
      frameTimeNanos < previous ||
      frameTimeNanos - previous >= intervalNanos
    ) {
      lastDrawNanos = frameTimeNanos
      return true
    }
    return false
  }

  fun reset() {
    lastDrawNanos = Long.MIN_VALUE
  }

  private companion object {
    // Replacing a full-window RenderEffect at 60 fps can starve input dispatch on mid-range
    // devices. The aura remains fluid at 30 fps while leaving alternate frames for interaction.
    const val DEFAULT_INTERVAL_NANOS = 33_333_334L
  }
}
