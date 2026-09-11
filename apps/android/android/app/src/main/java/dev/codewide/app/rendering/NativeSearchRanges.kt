package dev.codewide.app.rendering

/** UTF-16 offsets remain compatible with Android text spans, including emoji. */
internal fun nativeSearchRanges(source: String, query: String): List<IntRange> {
  val ranges = mutableListOf<IntRange>()
  for (token in query.trim().split(Regex("\\s+")).filter(String::isNotEmpty).distinct()) {
    var start = source.indexOf(token, ignoreCase = true)
    while (start >= 0) {
      ranges.add(start until start + token.length)
      start = source.indexOf(token, start + token.length, ignoreCase = true)
    }
  }
  return ranges
}
