package dev.codewide.app.rendering

import com.swmansion.enriched.markdown.input.editing.CodeInputShortcut
import com.swmansion.enriched.markdown.input.editing.EditableCodeContent
import com.swmansion.enriched.markdown.input.editing.EditContext
import com.swmansion.enriched.markdown.input.layout.InputLineSpacing
import com.swmansion.enriched.markdown.input.editing.EditableMentions
import com.swmansion.enriched.markdown.input.editing.MentionCoordinator
import com.swmansion.enriched.markdown.input.editing.MentionEvent
import com.swmansion.enriched.markdown.input.formatting.FormattingStore
import com.swmansion.enriched.markdown.input.formatting.InputParser
import com.swmansion.enriched.markdown.input.formatting.InputRemend
import com.swmansion.enriched.markdown.input.formatting.MarkdownSerializer
import com.swmansion.enriched.markdown.input.model.BlockRange
import com.swmansion.enriched.markdown.input.model.BlockType
import com.swmansion.enriched.markdown.input.model.FormattingRange
import com.swmansion.enriched.markdown.input.model.StyleType
import com.swmansion.enriched.markdown.parser.MarkdownASTNode
import com.swmansion.enriched.markdown.parser.MarkdownASTNode.NodeType
import org.junit.Assert.*
import org.junit.Test

/** Native editing contracts, not JS mocks. JNI parsing and Android IME rendering need a device. */
class ComposerMarkdownEditingTest {
  @Test fun emptyCodeCanBeRemovedEvenWhenItContainsAnInvisibleCaretAnchor() {
    for (content in listOf("", "\u200B")) {
      val text = StringBuilder("before\n${content}\nafter")
      val store = FormattingStore()
      store.addRange(FormattingRange(StyleType.CODE_BLOCK, 7, 7 + content.length))
      val code = store.allRanges.single()
      assertTrue(EditableCodeContent.isEmptyBlock(text, code))
      val start = code.start
      val end = code.end
      store.removeRange(code)
      text.delete(start, end)
      store.adjustForEdit(start, end - start, 0)
      assertTrue(store.allRanges.isEmpty())
      assertEquals("before\n\nafter", MarkdownSerializer.serialize(text.toString(), store.allRanges))
      text.insert(start, "normal")
      store.adjustForEdit(start, 0, 6)
      assertEquals("before\nnormal\nafter", MarkdownSerializer.serialize(text.toString(), store.allRanges))
    }
  }

  @Test fun deletingEmptyCodeNeverDropsActualCodeOrBlankCodeLines() {
    for (content in listOf("x", "\u200Bx", " ", "\n", "\u200B\n\u200B")) {
      assertFalse(EditableCodeContent.isEmptyBlock(content, FormattingRange(StyleType.CODE_BLOCK, 0, content.length)))
    }
    assertFalse(EditableCodeContent.isEmptyBlock("\u200B", FormattingRange(StyleType.INLINE_CODE, 0, 1)))
  }

  @Test fun addingMissingOutsideParagraphsPreservesCodeAndSupportsMentionInsertion() {
    for (before in listOf(true, false)) {
      val text = StringBuilder("literal")
      val store = FormattingStore()
      store.addRange(FormattingRange(StyleType.CODE_BLOCK, 0, text.length))
      val code = store.allRanges.single()
      val existing = if (before) EditableCodeContent.caretBefore(text, code) else EditableCodeContent.caretAfter(text, code)
      assertNull(existing)
      val offset = if (before) code.start else code.end
      text.insert(offset, '\n')
      store.adjustForEdit(offset, 0, 1, extendCode = false)
      val caret = if (before) offset else offset + 1
      text.insert(caret, "/Review")
      store.adjustForEdit(caret, 0, 7)
      assertEquals("literal", text.substring(code.start, code.end))
      assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, caret))
      val markdown = MarkdownSerializer.serialize(text.toString(), store.allRanges)
      if (before) assertEquals("/Review\n\u0060\u0060\u0060\nliteral\n\u0060\u0060\u0060", markdown)
      else assertEquals("\u0060\u0060\u0060\nliteral\n\u0060\u0060\u0060\n/Review", markdown)
    }
  }

  @Test fun anExplicitParagraphBetweenAdjacentCodeBlocksBelongsToNeitherBlock() {
    val text = StringBuilder("onetwo")
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.CODE_BLOCK, 0, 3))
    store.addRange(FormattingRange(StyleType.CODE_BLOCK, 3, 6))
    text.insert(3, "\n\n")
    store.adjustForEdit(3, 0, 2, extendCode = false)
    assertEquals(listOf("one", "two"), store.allRanges.map { text.substring(it.start, it.end) })
    assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, 4))
    text.insert(4, "/Review")
    store.adjustForEdit(4, 0, 7)
    assertEquals(listOf("one", "two"), store.allRanges.map { text.substring(it.start, it.end) })
    assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, 4))
  }

  @Test fun repeatedEnterKeepsBlankLinesInsideCodeAndLeavesAnEditableLastLine() {
    val insertion = EditableCodeContent.block("one")
    val text = StringBuilder(insertion.text)
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.CODE_BLOCK, insertion.start, insertion.end))
    val range = store.allRanges.single()
    var caret = range.end
    repeat(3) {
      val context = EditContext(caret, 0, 1, text.toString(), caret, caret, emptySet(), emptySet())
      text.insert(caret, '\n')
      assertFalse(EditableCodeContent.exitsOnEnter(range, context, text))
      store.adjustForEdit(caret, 0, 1)
      caret++
      if (EditableCodeContent.needsTailAnchor(text, range)) {
        val tail = range.end
        text.insert(tail, '\u200B')
        store.adjustForEdit(tail, 0, 1)
      }
      assertTrue("The blank line must remain covered by the native code span", caret < range.end)
      assertTrue(store.isStyleActive(StyleType.CODE_BLOCK, caret))
    }
    text.insert(caret, "next")
    store.adjustForEdit(caret, 0, 4)
    val markdown = MarkdownSerializer.serialize(text.toString(), store.allRanges)
    assertTrue(markdown.contains("```\none\n\n\nnext\n```"))
    assertFalse(markdown.contains('\u200B'))
  }

  @Test fun enterOnlyExitsInlineCodeAtItsEndNotBlocksOrPastedMultilineText() {
    val context = EditContext(4, 0, 1, "code", 4, 4, emptySet(), emptySet())
    val inline = FormattingRange(StyleType.INLINE_CODE, 0, 4)
    assertTrue(EditableCodeContent.exitsOnEnter(inline, context, "code\n"))
    assertFalse(EditableCodeContent.exitsOnEnter(FormattingRange(StyleType.CODE_BLOCK, 0, 4), context, "code\n"))
    assertFalse(EditableCodeContent.exitsOnEnter(inline, context.copy(editStart = 2), "co\nde"))
    assertFalse(EditableCodeContent.exitsOnEnter(inline, context.copy(insertedLength = 2), "code\nx"))
  }

  @Test fun codeEdgeCaretsTypeInTheSurroundingParagraphsWithoutGrowingCode() {
    for (before in listOf(true, false)) {
      val insertion = EditableCodeContent.block("literal")
      val text = StringBuilder(insertion.text)
      val store = FormattingStore()
      store.addRange(FormattingRange(StyleType.CODE_BLOCK, insertion.start, insertion.end))
      val range = store.allRanges.single()
      val caret = if (before) EditableCodeContent.caretBefore(text, range)!! else EditableCodeContent.caretAfter(text, range)!!
      assertTrue(caret < range.start || caret > range.end)
      text.insert(caret, "normal")
      store.adjustForEdit(caret, 0, 6)
      assertEquals("literal", text.substring(range.start, range.end))
      assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, caret))
      val markdown = MarkdownSerializer.serialize(text.toString(), store.allRanges)
      if (before) assertTrue(markdown.startsWith("normal\n```")) else assertTrue(markdown.endsWith("```\nnormal"))
    }
  }

  @Test fun codeEdgeCaretsNeverPointToNonexistentParagraphs() {
    val range = FormattingRange(StyleType.CODE_BLOCK, 0, 4)
    assertNull(EditableCodeContent.caretBefore("code", range))
    assertNull(EditableCodeContent.caretAfter("code", range))
    assertFalse(EditableCodeContent.needsTailAnchor("code", range))
    assertTrue(EditableCodeContent.needsTailAnchor("", FormattingRange(StyleType.CODE_BLOCK, 0, 0)))
  }

  @Test fun lineSpacingUsesPhysicalPixelsWithoutCompressingLargerGlyphs() {
    for (scale in listOf(1f, 2f, 3f, 3.5f)) {
      val ascent = -14f * scale
      val descent = 4f * scale
      val extra = InputLineSpacing.extra(21f * scale, ascent, descent)
      assertEquals(21f * scale, descent - ascent + extra, 0.001f)
      assertEquals(0f, InputLineSpacing.extra(21f * scale, -24f * scale, 6f * scale), 0.001f)
      assertEquals(0f, InputLineSpacing.extra(0f, ascent, descent), 0.001f)
    }
  }

  @Test fun emptyCodeBlockHasEditableContentAndRealParagraphsOutsideIt() {
    val insertion = EditableCodeContent.block("")
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.CODE_BLOCK, insertion.start, insertion.end))
    assertTrue(insertion.start > 0)
    assertTrue(insertion.end < insertion.text.length)
    assertEquals('\n', insertion.text[insertion.start - 1])
    assertEquals('\n', insertion.text[insertion.end])
    assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, 0))
    assertFalse(store.isStyleActive(StyleType.CODE_BLOCK, insertion.text.length))
    val typed = "val example = 1"
    val text = insertion.text.substring(0, insertion.end) + typed + insertion.text.substring(insertion.end)
    store.adjustForEdit(insertion.end, 0, typed.length)
    val markdown = MarkdownSerializer.serialize(text, store.allRanges)
    assertTrue(markdown.contains("```\n$typed\n```"))
    assertFalse(markdown.contains('\u200B'))
  }

  @Test fun codeInsertionPreservesSelectedMultilineTextIncludingLiteralMarkdown() {
    val content = "  **literal**\n  @value `x`"
    val insertion = EditableCodeContent.block(content)
    val range = FormattingRange(StyleType.CODE_BLOCK, insertion.start, insertion.end)
    assertEquals(content, insertion.text.substring(range.start, range.end))
    val markdown = MarkdownSerializer.serialize(insertion.text, listOf(range))
    assertTrue(markdown.contains(content))
    assertTrue(markdown.contains("```"))
  }

  @Test fun parsedEmptyCodeBlockRemainsEditableWithoutExportingItsAnchor() {
    val ast = MarkdownASTNode(NodeType.Document, children = listOf(MarkdownASTNode(NodeType.CodeBlock)))
    val parsed = InputParser.fromAst(ast, "```\n\n```")
    val range = parsed.formattingRanges.single()
    assertTrue(range.end > range.start)
    assertEquals(StyleType.CODE_BLOCK, range.type)
    val markdown = MarkdownSerializer.serialize(parsed.plainText, parsed.formattingRanges)
    assertTrue(markdown.contains("```\n\n```"))
    assertFalse(markdown.contains('\u200B'))
  }

  @Test fun deletingMentionTextDropsBindingAndReopensSuggestions() {
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.LINK, 0, 7, "https://example.com/skill", mentionIndicator = "/"))
    val mentions = MentionCoordinator(store)
    mentions.setIndicators(listOf("/", "@"))
    assertTrue(mentions.update("/Review", 7, 7).isEmpty())
    val detached = EditableMentions.detachForEdit(store, 6, 1)!!
    mentions.restore(detached.start, detached.end - 1, detached.mentionIndicator!!)
    store.adjustForEdit(6, 1, 0)
    val events = mentions.update("/Revie", 6, 6)
    assertTrue(events.contains(MentionEvent.Start("/")))
    assertTrue(events.contains(MentionEvent.Change("/", "Revie")))
    assertEquals("/Revie", MarkdownSerializer.serialize("/Revie", store.allRanges))
    assertTrue(mentions.update("/Revi", 5, 5).contains(MentionEvent.Change("/", "Revi")))
  }

  @Test fun multiwordMentionReopensAndCanBeEditedInTheMiddle() {
    val text = "@Composer discussion"
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.LINK, 0, text.length, "https://example.com/thread", mentionIndicator = "@"))
    assertNull(store.selectionAdjustedForAtomicLinks(10, 10, editableMentions = true))
    assertEquals(Pair(text.length, text.length), store.selectionAdjustedForAtomicLinks(10, 10))
    val detached = EditableMentions.detachForEdit(store, 10, 0)!!
    val mentions = MentionCoordinator(store)
    mentions.setIndicators(listOf("@"))
    mentions.restore(0, text.length + 1, detached.mentionIndicator!!)
    assertTrue(mentions.update("@Composer Xdiscussion", 11, 11).contains(MentionEvent.Change("@", "Composer X")))
  }

  @Test fun plainLinksRemainAtomicAndUnchanged() {
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.LINK, 0, 6, "https://example.com"))
    assertEquals(Pair(6, 6), store.selectionAdjustedForAtomicLinks(3, 3, editableMentions = true))
    assertNull(EditableMentions.detachForEdit(store, 5, 1))
    assertEquals("[Review](https://example.com)", MarkdownSerializer.serialize("Review", store.allRanges))
  }

  @Test fun codeAstPreservesLiteralWhitespaceLanguageAndInlineFormatting() {
    val ast = MarkdownASTNode(NodeType.Document, children = listOf(
      MarkdownASTNode(NodeType.CodeBlock, attributes = mapOf("language" to "kotlin"), children = listOf(
        MarkdownASTNode(NodeType.Text, "  val x = \"**literal**\"\n  next()\n"),
      )),
      MarkdownASTNode(NodeType.Paragraph, children = listOf(MarkdownASTNode(NodeType.Code, children = listOf(MarkdownASTNode(NodeType.Text, "x()"))))),
    ))
    val parsed = InputParser.fromAst(ast, "```kotlin\n  val x = \"**literal**\"\n  next()\n```\n\n`x()`")
    assertEquals("  val x = \"**literal**\"\n  next()\n\nx()", parsed.plainText)
    assertEquals(listOf(StyleType.CODE_BLOCK, StyleType.INLINE_CODE), parsed.formattingRanges.map { it.type })
    assertEquals("kotlin", parsed.formattingRanges.first().codeLanguage)
    val markdown = MarkdownSerializer.serialize(parsed.plainText, parsed.formattingRanges)
    assertEquals("```kotlin\n  val x = \"**literal**\"\n  next()\n```\n\n`x()`", markdown)
    assertEquals(markdown, InputRemend.complete(markdown))
  }

  @Test fun inlineCodeDoesNotRepeatTheHeadingPrefix() {
    val text = "Use foo() now"
    assertEquals("# Use `foo()` now", MarkdownSerializer.serialize(text,
      listOf(FormattingRange(StyleType.INLINE_CODE, 4, 9)), listOf(BlockRange(BlockType.HEADING_1, 0, text.length, 1))) { "# " })
  }

  @Test fun codeFencesCannotBeClosedByPayloadBackticks() {
    val block = "before\n```\nafter"
    assertEquals("````js\nbefore\n```\nafter\n````", MarkdownSerializer.serialize(block,
      listOf(FormattingRange(StyleType.CODE_BLOCK, 0, block.length, codeLanguage = "js"))))
    val inline = "`x`"
    assertEquals("`` `x` ``", MarkdownSerializer.serialize(inline, listOf(FormattingRange(StyleType.INLINE_CODE, 0, inline.length))))
  }

  @Test fun codeEditsKeepLanguageIncludingEmptyBlockAndPastedLiteral() {
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.CODE_BLOCK, 0, 1, codeLanguage = "ts"))
    store.adjustForEdit(0, 1, 0)
    assertEquals("```ts\n\n```", MarkdownSerializer.serialize("", store.allRanges))
    val payload = "**not bold**\n@not-a-mention"
    store.adjustForEdit(0, 0, payload.length)
    assertEquals("```ts\n$payload\n```", MarkdownSerializer.serialize(payload, store.allRanges))
  }

  @Test fun deletingAllInlineCodeDoesNotExportAnInvalidEmptyDelimiter() {
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.INLINE_CODE, 0, 1))
    store.adjustForEdit(0, 1, 0)
    assertEquals("", MarkdownSerializer.serialize("", store.allRanges))
  }

  @Test fun replacingASelectionUnbindsEveryTouchedMentionWithoutChangingOtherLinks() {
    val store = FormattingStore()
    store.addRange(FormattingRange(StyleType.LINK, 0, 4, "https://example.com/one", mentionIndicator = "@"))
    store.addRange(FormattingRange(StyleType.LINK, 5, 9, "https://example.com/two", mentionIndicator = "@"))
    store.addRange(FormattingRange(StyleType.LINK, 10, 14, "https://example.com/plain"))
    EditableMentions.detachForEdit(store, 1, 7)
    assertEquals(listOf("https://example.com/plain"), store.allRanges.map { it.url })
  }

  @Test fun shortcutsConvertOnlyCompletedCodeAndPreservePayload() {
    val opening = CodeInputShortcut.find("```ts\n", 6)!!
    assertEquals("", opening.payload)
    assertEquals("ts", opening.language)
    assertNull(CodeInputShortcut.find("`unfinished", 11))
    assertNull(CodeInputShortcut.find("```\n`not inline`", 16))
    val inline = CodeInputShortcut.find("Use `x()`", 9)!!
    assertEquals("x()", inline.payload)
    assertEquals(StyleType.INLINE_CODE, inline.type)
    val markdown = "before\n```ts\n  x()\n  y()\n```"
    val code = CodeInputShortcut.find(markdown, markdown.length)!!
    assertEquals("  x()\n  y()", code.payload)
    assertEquals("ts", code.language)
    assertEquals(StyleType.CODE_BLOCK, code.type)
  }
}
