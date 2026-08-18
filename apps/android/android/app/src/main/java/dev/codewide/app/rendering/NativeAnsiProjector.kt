package dev.codewide.app.rendering

/**
 * Projects terminal ANSI/SGR output into plain text plus immutable style runs.
 *
 * This intentionally models presentation, not a PTY screen. SGR colors and
 * text attributes survive, while cursor/device/OSC control sequences are
 * removed so untrusted command output cannot affect the Android UI.
 */
internal object NativeAnsiProjector {
  fun project(source: String): NativeAnsiProjection {
    if (source.isEmpty()) return NativeAnsiProjection("", emptyList())
    val text = StringBuilder(source.length)
    val runs = ArrayList<NativeAnsiRun>()
    var style = NativeAnsiStyle()
    var index = 0

    fun append(value: String) {
      if (value.isEmpty()) return
      val start = text.length
      text.append(value)
      val end = text.length
      if (style == NativeAnsiStyle()) return
      val previous = runs.lastOrNull()
      if (previous != null && previous.end == start && previous.style == style) {
        runs[runs.lastIndex] = previous.copy(end = end)
      } else {
        runs += NativeAnsiRun(start, end, style)
      }
    }

    while (index < source.length) {
      val character = source[index]
      when {
        character == ESCAPE && index + 1 < source.length && source[index + 1] == '[' -> {
          val sequence = csiSequence(source, index + 2)
          if (sequence == null) {
            index = source.length
          } else {
            if (sequence.final == 'm') style = applySgr(style, sequence.payload)
            index = sequence.nextIndex
          }
        }
        character == C1_CSI -> {
          val sequence = csiSequence(source, index + 1)
          if (sequence == null) {
            index = source.length
          } else {
            if (sequence.final == 'm') style = applySgr(style, sequence.payload)
            index = sequence.nextIndex
          }
        }
        character == ESCAPE && index + 1 < source.length && source[index + 1] == ']' -> {
          index = skipOsc(source, index + 2)
        }
        character == ESCAPE && index + 1 < source.length && source[index + 1] in listOf('P', 'X', '^', '_') -> {
          index = skipStringControl(source, index + 2)
        }
        character == ESCAPE -> {
          // Charset selection and other short ESC commands have no visual
          // meaning in a transcript. Consume their command byte as well.
          index = (index + 2).coerceAtMost(source.length)
        }
        character == '\r' -> {
          if (source.getOrNull(index + 1) != '\n') append("\n")
          index += 1
        }
        character == '\n' || character == '\t' -> {
          append(character.toString())
          index += 1
        }
        character.code < 0x20 || character.code == 0x7f -> index += 1
        else -> {
          var end = index + 1
          while (end < source.length) {
            val next = source[end]
            if (next == ESCAPE || next == C1_CSI || next == '\r' || next == '\n' || next == '\t' || next.code < 0x20 || next.code == 0x7f) break
            end += 1
          }
          append(source.substring(index, end))
          index = end
        }
      }
    }
    return NativeAnsiProjection(text.toString(), runs)
  }

  private fun applySgr(current: NativeAnsiStyle, payload: String): NativeAnsiStyle {
    val codes = sgrCodes(payload)
    var style = current
    var index = 0
    while (index < codes.size) {
      val code = codes[index]
      when (code) {
        0 -> style = NativeAnsiStyle()
        1 -> style = style.copy(bold = true, dim = false)
        2 -> style = style.copy(dim = true, bold = false)
        3 -> style = style.copy(italic = true)
        4, 21 -> style = style.copy(underline = true)
        7 -> style = style.copy(inverse = true)
        8 -> style = style.copy(hidden = true)
        9 -> style = style.copy(strikethrough = true)
        22 -> style = style.copy(bold = false, dim = false)
        23 -> style = style.copy(italic = false)
        24 -> style = style.copy(underline = false)
        27 -> style = style.copy(inverse = false)
        28 -> style = style.copy(hidden = false)
        29 -> style = style.copy(strikethrough = false)
        in 30..37 -> style = style.copy(foreground = ANSI_COLORS[code - 30])
        39 -> style = style.copy(foreground = null)
        in 40..47 -> style = style.copy(background = ANSI_COLORS[code - 40])
        49 -> style = style.copy(background = null)
        in 90..97 -> style = style.copy(foreground = ANSI_BRIGHT_COLORS[code - 90])
        in 100..107 -> style = style.copy(background = ANSI_BRIGHT_COLORS[code - 100])
        38, 48 -> {
          val extended = extendedColor(codes, index + 1)
          if (extended != null) {
            style = if (code == 38) style.copy(foreground = extended.color) else style.copy(background = extended.color)
            index = extended.lastIndex
          }
        }
      }
      index += 1
    }
    return style
  }

  private fun sgrCodes(payload: String): List<Int> {
    if (payload.isBlank()) return listOf(0)
    return payload.split(';').flatMap { group ->
      if (':' !in group) listOf(group.toIntOrNull() ?: 0)
      else {
        val values = group.split(':').mapNotNull(String::toIntOrNull)
        // Colon notation is useful for extended colors (38:2::r:g:b). For
        // underline variants such as 4:3, the subtype is not another SGR code.
        if (values.firstOrNull() == 38 || values.firstOrNull() == 48) values else values.take(1)
      }
    }
  }

  private fun extendedColor(codes: List<Int>, start: Int): ExtendedColor? {
    return when (codes.getOrNull(start)) {
      5 -> codes.getOrNull(start + 1)?.let { ExtendedColor(xtermColor(it.coerceIn(0, 255)), start + 1) }
      2 -> {
        val red = codes.getOrNull(start + 1) ?: return null
        val green = codes.getOrNull(start + 2) ?: return null
        val blue = codes.getOrNull(start + 3) ?: return null
        ExtendedColor(rgb(red, green, blue), start + 3)
      }
      else -> null
    }
  }

  private fun xtermColor(index: Int): Int = when (index) {
    in 0..7 -> ANSI_COLORS[index]
    in 8..15 -> ANSI_BRIGHT_COLORS[index - 8]
    in 16..231 -> {
      val offset = index - 16
      val red = offset / 36
      val green = (offset % 36) / 6
      val blue = offset % 6
      rgb(cubeChannel(red), cubeChannel(green), cubeChannel(blue))
    }
    else -> {
      val gray = 8 + (index - 232) * 10
      rgb(gray, gray, gray)
    }
  }

  private fun cubeChannel(value: Int): Int = if (value == 0) 0 else 55 + value * 40

  private fun rgb(red: Int, green: Int, blue: Int): Int =
    (red.coerceIn(0, 255) shl 16) or (green.coerceIn(0, 255) shl 8) or blue.coerceIn(0, 255)

  private fun csiSequence(source: String, payloadStart: Int): CsiSequence? {
    var index = payloadStart
    while (index < source.length) {
      val character = source[index]
      if (character.code in 0x40..0x7e) {
        return CsiSequence(source.substring(payloadStart, index), character, index + 1)
      }
      index += 1
    }
    return null
  }

  private fun skipOsc(source: String, start: Int): Int {
    var index = start
    while (index < source.length) {
      if (source[index] == '\u0007') return index + 1
      if (source[index] == ESCAPE && source.getOrNull(index + 1) == '\\') return index + 2
      index += 1
    }
    return source.length
  }

  private fun skipStringControl(source: String, start: Int): Int {
    var index = start
    while (index < source.length) {
      if (source[index] == ESCAPE && source.getOrNull(index + 1) == '\\') return index + 2
      index += 1
    }
    return source.length
  }

  private data class CsiSequence(val payload: String, val final: Char, val nextIndex: Int)
  private data class ExtendedColor(val color: Int, val lastIndex: Int)

  private const val ESCAPE = '\u001b'
  private const val C1_CSI = '\u009b'
  private val ANSI_COLORS = intArrayOf(
    0x1d1f21, 0xcc6666, 0xb5bd68, 0xf0c674, 0x81a2be, 0xb294bb, 0x8abeb7, 0xc5c8c6,
  )
  private val ANSI_BRIGHT_COLORS = intArrayOf(
    0x969896, 0xde935f, 0x8c9440, 0xf0c674, 0x81a2be, 0x85678f, 0x5e8d87, 0xffffff,
  )
}

internal data class NativeAnsiProjection(
  val text: String,
  val runs: List<NativeAnsiRun>,
)

internal data class NativeAnsiRun(
  val start: Int,
  val end: Int,
  val style: NativeAnsiStyle,
)

internal data class NativeAnsiStyle(
  val foreground: Int? = null,
  val background: Int? = null,
  val bold: Boolean = false,
  val dim: Boolean = false,
  val italic: Boolean = false,
  val underline: Boolean = false,
  val inverse: Boolean = false,
  val hidden: Boolean = false,
  val strikethrough: Boolean = false,
)
