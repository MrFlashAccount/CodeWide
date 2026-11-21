package dev.codewide.app.rendering

import android.graphics.Color
import android.graphics.Typeface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.util.TypedValue
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import kotlin.math.ceil
import kotlin.math.roundToInt

class MarkdownListManager : SimpleViewManager<MarkdownListText>() {
  override fun getName() = "CodeWideMarkdownList"
  override fun createViewInstance(context: ThemedReactContext) = MarkdownListText(context)

  @ReactProp(name = "content")
  fun setContent(view: MarkdownListText, content: ReadableMap?) = view.bind(content)

  override fun getExportedCustomDirectEventTypeConstants() = mutableMapOf<String, Any>(
    "topListSelection" to mapOf("registrationName" to "onListSelection"),
    "topListHeight" to mapOf("registrationName" to "onListHeight"),
  )
}

private class ListEvent(surface: Int, id: Int, val kind: String, val fields: WritableMap) :
  Event<ListEvent>(surface, id) {
  override fun getEventName() = kind
  override fun getEventData() = fields
  override fun canCoalesce() = false
}

private data class Paragraph(val index: Int, val start: Int, val end: Int)
private const val REVIEW_ACTION = 0x434c

/** One Android text layout and selection owner per bounded group. Offsets are UTF-16. */
class MarkdownListText(private val react: ThemedReactContext) : TextView(react) {
  private val paragraphs = mutableListOf<Paragraph>()
  private var reviewEnabled = false
  private var lastHeight = -1
  private val density get() = resources.displayMetrics.density

  init {
    includeFontPadding = false
    setPadding(0, 0, 0, 0)
    setTextIsSelectable(true)
    breakStrategy = Layout.BREAK_STRATEGY_HIGH_QUALITY
    customSelectionActionModeCallback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        updateMenu(menu)
        return true
      }
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = updateMenu(menu)
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId != REVIEW_ACTION) return false
        val p = selectedParagraph() ?: return false
        emit("topListSelection", Arguments.createMap().apply {
          putInt("index", p.index)
          putInt("start", minOf(selectionStart, selectionEnd) - p.start)
          putInt("end", maxOf(selectionStart, selectionEnd) - p.start)
        })
        mode.finish()
        return true
      }
      override fun onDestroyActionMode(mode: ActionMode) = Unit
    }
  }

  private fun selectedParagraph(): Paragraph? {
    val start = minOf(selectionStart, selectionEnd)
    val end = maxOf(selectionStart, selectionEnd)
    return paragraphs.firstOrNull { start >= it.start && end <= it.end && start < end }
  }

  private fun updateMenu(menu: Menu): Boolean {
    val show = reviewEnabled && selectedParagraph() != null
    if ((menu.findItem(REVIEW_ACTION) != null) == show) return false
    if (show) menu.add(Menu.NONE, REVIEW_ACTION, Menu.NONE, "Review").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
    else menu.removeItem(REVIEW_ACTION)
    return true
  }

  private fun emit(name: String, fields: WritableMap) {
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(react, id) ?: return
    dispatcher.dispatchEvent(ListEvent(UIManagerHelper.getSurfaceId(react), id, name, fields))
  }

  fun bind(content: ReadableMap?) {
    paragraphs.clear()
    reviewEnabled = content?.getBoolean("review") == true
    val lines = content?.getArray("lines")
    if (content == null || lines == null) {
      text = ""
      return
    }
    fun pixels(key: String) = (content.getDouble(key) * density).roundToInt()
    typeface = ReactFontManager.getInstance().getTypeface(requireNotNull(content.getString("font")), Typeface.NORMAL, context.assets)
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, content.getDouble("fontSize").toFloat())
    setTextColor(Color.parseColor(content.getString("textColor")))
    val muted = Color.parseColor(content.getString("markerColor"))
    val checked = Color.parseColor(content.getString("checkedColor"))
    val inset = pixels("inset")
    val lineHeight = pixels("lineHeight")
    val markerGap = pixels("markerGap")
    val iconSize = pixels("iconSize")
    val gap = pixels("gap")
    val nestedGap = pixels("nestedGap")
    val spans = SpannableStringBuilder()
    for (index in 0 until lines.size()) {
      val row = lines.getMap(index) ?: continue
      val start = spans.length
      spans.append(row.getString("body"))
      paragraphs.add(Paragraph(index, start, spans.length))
      val last = index + 1 == lines.size()
      if (!last) spans.append('\n')
      val marker = row.getString("marker").orEmpty()
      // A scaled or multi-digit marker can be wider than the standard Markdown gutter.
      val markerWidth = if (marker == "checked" || marker == "unchecked") iconSize
        else ceil(paint.measureText(marker)).toInt()
      val margin = inset * row.getInt("depth") + maxOf(inset, markerWidth + markerGap)
      val after = if (last) 0 else if (row.getBoolean("followedByChildren")) nestedGap else gap
      spans.setSpan(ListMarker(marker, margin, markerGap, iconSize, if (marker == "checked") checked else muted),
        start, spans.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      spans.setSpan(ListLineHeight(lineHeight, after, spans.length), start, spans.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    lastHeight = -1
    setText(spans, BufferType.SPANNABLE)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    val height = layout?.height ?: return
    if (height <= 0 || height == lastHeight) return
    lastHeight = height
    emit("topListHeight", Arguments.createMap().apply { putDouble("height", height / density.toDouble()) })
  }
}
