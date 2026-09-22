package dev.codewide.app.remote

internal data class VoiceOverlayDisplayLayout(val width: Int, val height: Int, val area: OverlaySafeBounds) {
  fun bounds(size: Int): OverlaySafeBounds = OverlaySafeBounds(
    area.minX, area.minY,
    (area.maxX - size).coerceAtLeast(area.minX), (area.maxY - size).coerceAtLeast(area.minY),
  )
}

/** Coalesces configuration/insets signals; only a repeated complete display snapshot can commit. */
internal class VoiceOverlayLayoutSettler {
  private var candidate: VoiceOverlayDisplayLayout? = null
  private var committed: VoiceOverlayDisplayLayout? = null

  fun observe(layout: VoiceOverlayDisplayLayout): Boolean {
    if (candidate != layout) {
      candidate = layout
      return false
    }
    return true
  }

  fun commit(layout: VoiceOverlayDisplayLayout): Boolean {
    if (committed == layout) return false
    committed = layout
    return true
  }

  fun resetCandidate() { candidate = null }
}
