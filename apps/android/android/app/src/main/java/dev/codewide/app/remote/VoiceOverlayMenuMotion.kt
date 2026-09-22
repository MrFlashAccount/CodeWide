package dev.codewide.app.remote

internal data class VoiceOverlayActionFrame(val travel: Float, val alpha: Float, val scale: Float)

/** One reversible timeline: 240ms motion per action, staggered by 30ms. */
internal object VoiceOverlayMenuMotion {
  const val OPEN_DURATION_MS = 360L
  const val CLOSE_DURATION_MS = 180L
  const val DRAG_CLOSE_DURATION_MS = 100L
  // The cubic below peaks below 1.025. Placement reserves this complete excursion.
  const val MAX_TRAVEL = 1.025f

  fun frame(progress: Float, index: Int): VoiceOverlayActionFrame {
    val local = ((progress * OPEN_DURATION_MS - index * 30f) / 240f).coerceIn(0f, 1f)
    val remainder = local - 1f
    val travel = 1f + 1.6f * remainder * remainder * remainder + 0.6f * remainder * remainder
    return VoiceOverlayActionFrame(travel, (local * 3f).coerceAtMost(1f), 0.6f + 0.4f * local)
  }
}
