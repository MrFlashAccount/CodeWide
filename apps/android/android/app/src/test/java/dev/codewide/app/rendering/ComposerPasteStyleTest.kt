package dev.codewide.app.rendering

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.TextAttribute
import com.swmansion.enriched.markdown.input.editing.MatchStyleInputConnection
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class ComposerPasteStyleTest {
  private val content = "**Title**\n```kotlin\n  val emoji = \"😀\"\n```\n"

  private fun styledText(): SpannableString = SpannableString(content).apply {
    setSpan(ForegroundColorSpan(Color.TRANSPARENT), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(BackgroundColorSpan(Color.BLACK), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(StyleSpan(Typeface.BOLD_ITALIC), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  @Test fun keyboardPasteDropsSourceAppearanceWithoutChangingMarkdownOrCursor() {
    val target = RecordingConnection()
    val input = MatchStyleInputConnection(target)
    val source = styledText()
    assertFalse(input.commitText(source, -2))
    assertPlainInsertion(target, -2)
    assertEquals(3, source.getSpans(0, source.length, Any::class.java).size)
  }

  @Test fun modernKeyboardPastePreservesTextAttributesAndDropsAppearance() {
    val target = RecordingConnection()
    val input = MatchStyleInputConnection(target)
    val attributes = TextAttribute.Builder().build()
    assertFalse(input.commitText(styledText(), 1, attributes))
    assertPlainInsertion(target, 1)
    assertSame(attributes, target.attributes)
  }

  @Test fun keyboardReplacementPreservesRangeAndDropsAppearance() {
    val target = RecordingConnection()
    val input = MatchStyleInputConnection(target)
    val attributes = TextAttribute.Builder().build()
    assertFalse(input.replaceText(2, 7, styledText(), 0, attributes))
    assertPlainInsertion(target, 0)
    assertEquals(2, target.start)
    assertEquals(7, target.end)
    assertSame(attributes, target.attributes)
  }

  @Test fun composingTextKeepsImeSpansAndIdentity() {
    val target = RecordingConnection()
    val input = MatchStyleInputConnection(target)
    val source = styledText()
    assertFalse(input.setComposingText(source, 1))
    assertSame(source, target.received)
    assertEquals(1, target.cursor)
  }

  @Test fun deletionAndPlainTextCommitsStillReachTheKeyboardTarget() {
    val target = RecordingConnection()
    val input = MatchStyleInputConnection(target)
    for (text in listOf("", "a", "😀", "\n")) {
      assertFalse(input.commitText(text, 1))
      assertEquals(text, target.received)
    }
  }

  private fun assertPlainInsertion(target: RecordingConnection, cursor: Int) {
    assertEquals(content, target.received.toString())
    assertFalse("Source appearance must not reach the Editable", target.received is Spanned)
    assertEquals(cursor, target.cursor)
  }

  private class RecordingConnection : BaseInputConnection(View(RuntimeEnvironment.getApplication()), true) {
    var received: CharSequence = ""
    var cursor = 0
    var attributes: TextAttribute? = null
    var start = 0
    var end = 0

    override fun commitText(text: CharSequence, newCursorPosition: Int): Boolean {
      received = text
      cursor = newCursorPosition
      return false
    }

    override fun commitText(text: CharSequence, newCursorPosition: Int, textAttribute: TextAttribute?): Boolean {
      attributes = textAttribute
      return commitText(text, newCursorPosition)
    }

    override fun replaceText(start: Int, end: Int, text: CharSequence, newCursorPosition: Int, textAttribute: TextAttribute?): Boolean {
      this.start = start
      this.end = end
      return commitText(text, newCursorPosition, textAttribute)
    }

    override fun setComposingText(text: CharSequence, newCursorPosition: Int): Boolean =
      commitText(text, newCursorPosition)
  }
}
