package dev.codewide.app.rendering

import java.text.BreakIterator
import java.util.Locale

/** A bounded, append-only animation tail; settled text never returns to zero opacity. */
internal class StreamingRevealState(
  private val seenLength: Int = 0,
  private val clock: StreamingRevealClock = StreamingRevealClock(),
) {
  var source = ""
    private set
  val glyphs = mutableListOf<RevealGlyph>()
  private var initialized = false

  fun update(next: String, now: Long, animate: Boolean) {
    if (initialized && next == source) {
      if (!animate) glyphs.clear()
      return
    }
    val append = !initialized || next.startsWith(source)
    val start = if (initialized) source.length else seenLength.coerceAtMost(next.length)
    source = next
    initialized = true
    if (!animate || !append) {
      glyphs.clear()
      return
    }
    val earliest = start
    glyphs.removeAll { it.finished(now) }
    if (earliest >= next.length) return
    val boundaries = BreakIterator.getCharacterInstance(Locale.ROOT)
    boundaries.setText(next)
    var from = if (boundaries.isBoundary(earliest)) earliest else boundaries.following(earliest)
    // Normal deltas are grapheme-by-grapheme. A huge snapshot uses at most 512
    // spans covering ALL new text, instead of flashing everything but its tail.
    val stride = maxOf(1, (next.length - earliest + MAX_NEW_SPANS - 1) / MAX_NEW_SPANS)
    while (from < next.length && from != BreakIterator.DONE) {
      val candidate = minOf(next.length, from + stride)
      val to = if (boundaries.isBoundary(candidate)) candidate else boundaries.following(candidate)
      if (to == BreakIterator.DONE) break
      glyphs.add(RevealGlyph(from, to, clock.reserve(now), clock))
      from = to
    }
  }

  fun finish() { glyphs.clear() }

  fun settledLength(now: Long): Int = glyphs.firstOrNull { it.opacity(now) < 1f }?.start ?: source.length

  companion object {
    const val MAX_NEW_SPANS = 512
  }
}

internal data class RevealGlyph(val start: Int, val end: Int, val position: Double, private val clock: StreamingRevealClock) {
  fun opacity(now: Long): Float = clock.opacity(position, now)
  fun highlight(now: Long): Float = clock.highlight(position, now)
  fun finished(now: Long): Boolean = clock.finished(position, now)
}
