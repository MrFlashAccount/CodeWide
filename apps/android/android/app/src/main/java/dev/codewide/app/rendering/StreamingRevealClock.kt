package dev.codewide.app.rendering

import kotlin.math.exp

/** One moving reading-order front per message, not one timer per network batch.
 * A large backlog increases velocity continuously instead of exposing its prefix.
 */
internal class StreamingRevealClock {
  private var front = 0.0
  private var issued = 0.0
  private var previousTime: Long? = null

  fun reserve(now: Long): Double {
    advance(now)
    val position = maxOf(issued, front)
    issued = position + 1.0
    return position
  }

  fun opacity(position: Double, now: Long): Float {
    advance(now)
    val phase = ((front - position) / FADE_WIDTH).coerceIn(0.0, 1.0)
    return (phase * phase * (3.0 - 2.0 * phase)).toFloat()
  }

  fun highlight(position: Double, now: Long): Float {
    advance(now)
    val phase = ((front - position - FADE_WIDTH) / SHIMMER_WIDTH).coerceIn(0.0, 1.0)
    return (0.85 * kotlin.math.sin(Math.PI * phase).let { it * it }).toFloat()
  }

  fun finished(position: Double, now: Long): Boolean {
    advance(now)
    return front >= position + FADE_WIDTH + SHIMMER_WIDTH
  }

  private fun advance(now: Long) {
    val previous = previousTime
    previousTime = now
    if (previous == null || now <= previous) return
    val remaining = (issued + FADE_WIDTH - front).coerceAtLeast(0.0)
    val seconds = (now - previous) / 1000.0 * 1.12
    // Integrate an exponential catch-up until it meets normal reading speed,
    // then a linear front. No burst boundary changes an existing glyph's alpha.
    val threshold = CHARACTERS_PER_SECOND * CATCH_UP_SECONDS
    val fastSeconds = if (remaining > threshold)
      minOf(seconds, kotlin.math.ln(remaining / threshold) * CATCH_UP_SECONDS) else 0.0
    val fastDistance = remaining * (1.0 - exp(-fastSeconds / CATCH_UP_SECONDS))
    // Let the glint finish behind the opaque letters without accelerating the
    // reading front or keeping fully settled glyphs in the paint loop.
    val animationRemaining = (issued + FADE_WIDTH + SHIMMER_WIDTH - front).coerceAtLeast(0.0)
    front += minOf(animationRemaining, fastDistance + (seconds - fastSeconds) * CHARACTERS_PER_SECOND)
  }

  private companion object {
    const val CHARACTERS_PER_SECOND = 70.0
    const val CATCH_UP_SECONDS = 0.18
    const val FADE_WIDTH = 4.0
    const val SHIMMER_WIDTH = 14.0
  }
}
