package dev.codewide.app.performance

/** Timestamp attribution survives delayed frame callbacks; no coordinates or content are retained. */
internal class ScrollActivityHistory {
  private data class Interval(val start: Long, var end: Long)
  private val intervals = java.util.ArrayDeque<Interval>()

  @Synchronized
  fun record(atNanos: Long) {
    val start = atNanos - 50_000_000L
    val end = atNanos + 250_000_000L
    val last = intervals.peekLast()
    if (last != null && start <= last.end) last.end = maxOf(last.end, end)
    else {
      if (intervals.size == 64) intervals.removeFirst()
      intervals.addLast(Interval(start, end))
    }
  }

  @Synchronized
  fun contains(atNanos: Long): Boolean = intervals.any { atNanos in it.start..it.end }
}
