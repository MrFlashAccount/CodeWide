package dev.codewide.app.remote

internal object ProjectionCursorPolicy {
  fun accepts(nativeCursor: Long, previousProjection: Long?, candidate: Long): Boolean =
    candidate <= nativeCursor && (previousProjection == null || candidate > previousProjection)
}
