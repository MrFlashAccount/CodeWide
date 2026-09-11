package dev.codewide.app.rendering

/** Retarget a drawing transition from its current visual position, not its previous goal. */
internal data class FluidLayoutStart(val translation: Float, val visibleHeight: Float)

internal fun fluidLayoutStart(
  previousTop: Int,
  nextTop: Int,
  previousHeight: Int,
  translation: Float,
  clippedHeight: Int?,
): FluidLayoutStart = FluidLayoutStart(
  translation = previousTop - nextTop + translation,
  visibleHeight = (clippedHeight ?: previousHeight).coerceAtLeast(0).toFloat(),
)
