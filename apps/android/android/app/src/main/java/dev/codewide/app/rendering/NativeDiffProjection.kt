package dev.codewide.app.rendering

import com.github.difflib.text.DiffRow
import com.github.difflib.text.DiffRowGenerator
import com.github.difflib.unifieddiff.UnifiedDiffReader
import java.io.ByteArrayInputStream

internal enum class NativeDiffLineKind {
  META,
  CONTEXT,
  ADDITION,
  DELETION,
}

internal data class NativeDiffLine(
  val start: Int,
  val end: Int,
  val oldLine: Int?,
  val newLine: Int?,
  val kind: NativeDiffLineKind,
)

internal data class NativeDiffProjection(
  val code: String,
  val lines: List<NativeDiffLine>,
  val gutter: String,
)

/**
 * Adapts Codex patch fragments to java-diff-utils and projects its structured
 * rows into the native TextView. Patch parsing, hunk coordinates, and row
 * alignment stay library-owned; this class only maps rows to presentation.
 */
internal object NativeDiffProjector {
  private data class Row(
    val text: String,
    val oldLine: Int?,
    val newLine: Int?,
    val kind: NativeDiffLineKind,
  )

  private val rowGenerator =
    DiffRowGenerator.create()
      .showInlineDiffs(false)
      .reportLinesUnchanged(true)
      .lineNormalizer { it }
      .build()

  fun project(source: String): NativeDiffProjection {
    val rows = runCatching { libraryRows(source) }.getOrElse { fallbackRows(source) }.ifEmpty {
      listOf(Row("", null, null, NativeDiffLineKind.CONTEXT))
    }
    return projection(rows)
  }

  private fun libraryRows(source: String): List<Row> {
    val normalized = normalizePatch(source).joinToString("\n")
    val parsed = UnifiedDiffReader.parseUnifiedDiff(ByteArrayInputStream(normalized.toByteArray(Charsets.UTF_8)))
    return buildList {
      val deltas = parsed.files.flatMap { it.patch.deltas }.sortedBy { it.source.position }
      for (delta in deltas) {
        var oldLine = delta.source.position + 1
        var newLine = delta.target.position + 1
        val diffRows = rowGenerator.generateDiffRows(delta.source.lines, delta.target.lines)
        for (row in diffRows) {
          when (row.tag) {
            DiffRow.Tag.EQUAL -> {
              add(Row(row.newLine, oldLine, newLine, NativeDiffLineKind.CONTEXT))
              oldLine += 1
              newLine += 1
            }
            DiffRow.Tag.DELETE -> {
              add(Row(row.oldLine, oldLine, null, NativeDiffLineKind.DELETION))
              oldLine += 1
            }
            DiffRow.Tag.INSERT -> {
              add(Row(row.newLine, null, newLine, NativeDiffLineKind.ADDITION))
              newLine += 1
            }
            DiffRow.Tag.CHANGE -> {
              if (row.oldLine.isNotEmpty()) {
                add(Row(row.oldLine, oldLine, null, NativeDiffLineKind.DELETION))
                oldLine += 1
              }
              if (row.newLine.isNotEmpty()) {
                add(Row(row.newLine, null, newLine, NativeDiffLineKind.ADDITION))
                newLine += 1
              }
            }
          }
        }
      }
    }
  }

  /** java-diff-utils requires file headers and at least one hunk header. */
  private fun normalizePatch(source: String): List<String> {
    val raw = source.split('\n')
    val firstHunk = raw.indexOfFirst { it.startsWith("@@ ") }
    val preamble = if (firstHunk >= 0) raw.take(firstHunk) else raw
    val hasFileHeaders = preamble.windowed(2).any { (first, second) ->
      first.startsWith("--- ") && second.startsWith("+++ ")
    }
    val hasHunk = raw.any { it.startsWith("@@ ") }
    if (hasHunk) return if (hasFileHeaders) raw else listOf("--- a/file", "+++ b/file") + raw

    val oldCount = raw.count { it.startsWith("-") && !it.startsWith("--- ") }
    val newCount = raw.count { it.startsWith("+") && !it.startsWith("+++ ") }
    val syntheticHunk = "@@ -1,$oldCount +1,$newCount @@"
    if (hasFileHeaders) {
      val oldHeader = preamble.indexOfFirst { it.startsWith("--- ") }
      return raw.take(oldHeader + 2) + syntheticHunk + raw.drop(oldHeader + 2)
    }
    return listOf("--- a/file", "+++ b/file", syntheticHunk) + raw
  }

  /**
   * Malformed third-party patches still remain readable, but never expose
   * transport control lines. Numbering is intentionally best-effort here.
   */
  private fun fallbackRows(source: String): List<Row> {
    var oldLine = 1
    var newLine = 1
    return buildList {
      for (line in source.split('\n')) {
        if (isTransportLine(line)) continue
        when {
          line.startsWith("+") -> add(Row(line.drop(1), null, newLine++, NativeDiffLineKind.ADDITION))
          line.startsWith("-") -> add(Row(line.drop(1), oldLine++, null, NativeDiffLineKind.DELETION))
          else -> {
            add(Row(line.removePrefix(" "), oldLine, newLine, NativeDiffLineKind.CONTEXT))
            oldLine += 1
            newLine += 1
          }
        }
      }
    }
  }

  private fun isTransportLine(line: String): Boolean =
    line.startsWith("@@ ") ||
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\ No newline at end of file")

  private fun projection(rows: List<Row>): NativeDiffProjection {
    val code = rows.joinToString("\n") { it.text }
    val projected = mutableListOf<NativeDiffLine>()
    var offset = 0
    rows.forEachIndexed { index, row ->
      val spanEnd = offset + row.text.length + if (index < rows.lastIndex) 1 else 0
      projected += NativeDiffLine(offset, spanEnd, row.oldLine, row.newLine, row.kind)
      offset = spanEnd
    }
    val digits = projected.maxOfOrNull { row ->
      maxOf(row.oldLine ?: 0, row.newLine ?: 0).toString().length
    }?.coerceAtLeast(1) ?: 1
    val gutter = projected.joinToString("\n") { row ->
      val old = row.oldLine?.toString()?.padStart(digits).orEmpty().padStart(digits)
      val new = row.newLine?.toString()?.padStart(digits).orEmpty().padStart(digits)
      val marker = when (row.kind) {
        NativeDiffLineKind.ADDITION -> "+"
        NativeDiffLineKind.DELETION -> "−"
        else -> " "
      }
      "$old $new $marker"
    }
    return NativeDiffProjection(code, projected, gutter)
  }
}
