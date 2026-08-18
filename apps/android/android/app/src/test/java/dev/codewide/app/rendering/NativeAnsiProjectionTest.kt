package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAnsiProjectionTest {
  @Test
  fun projectsStandardColorsAndResetWithoutEscapeText() {
    val projection = NativeAnsiProjector.project("plain \u001b[31mred\u001b[0m done")

    assertEquals("plain red done", projection.text)
    assertEquals(1, projection.runs.size)
    assertEquals("red", projection.text.substring(projection.runs.single().start, projection.runs.single().end))
    assertEquals(0xcc6666, projection.runs.single().style.foreground)
  }

  @Test
  fun projectsTrueColorIndexedColorAndAttributes() {
    val projection = NativeAnsiProjector.project("\u001b[1;3;4;38;2;12;34;56;48;5;236mstyled\u001b[0m")
    val style = projection.runs.single().style

    assertEquals("styled", projection.text)
    assertEquals(0x0c2238, style.foreground)
    assertEquals(0x303030, style.background)
    assertTrue(style.bold)
    assertTrue(style.italic)
    assertTrue(style.underline)
  }

  @Test
  fun supportsColonTrueColorAndAttributeReset() {
    val projection = NativeAnsiProjector.project("\u001b[38:2::1:2:3;7mA\u001b[27;39mB")

    assertEquals("AB", projection.text)
    assertEquals(1, projection.runs.size)
    assertEquals(0x010203, projection.runs.first().style.foreground)
    assertTrue(projection.runs.first().style.inverse)
    assertEquals(0, projection.runs.first().start)
    assertEquals(1, projection.runs.first().end)
  }

  @Test
  fun removesOscLinksAndNonStylingCsiCommands() {
    val projection = NativeAnsiProjector.project("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\u001b[2K ok")

    assertEquals("link ok", projection.text)
    assertTrue(projection.runs.isEmpty())
  }

  @Test
  fun turnsStandaloneCarriageReturnsIntoReadableProgressLines() {
    val projection = NativeAnsiProjector.project("10%\r20%\r\ncomplete")

    assertEquals("10%\n20%\ncomplete", projection.text)
  }
}
