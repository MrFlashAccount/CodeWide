package dev.codewide.app.rendering

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.style.LineHeightSpan
import android.os.Trace
import android.util.TypedValue
import kotlin.math.ceil
import kotlin.math.floor
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import kotlin.math.roundToInt

/** Installed only by the experiment build. Android owns visible holders, measurement and scrolling. */
class LabTranscriptManager : SimpleViewManager<LabTranscript>() {
  override fun getName() = "CodeWideLabTranscript"
  override fun createViewInstance(react: ThemedReactContext) = LabTranscript(react)
  @ReactProp(name = "window")
  fun setWindow(view: LabTranscript, window: ReadableMap?) = view.install(window)
}

class LabTranscript(private val react: ThemedReactContext) : RecyclerView(react) {
  private data class Row(val key: String, val kind: String, val model: ReadableMap)
  private var rows: List<Row> = emptyList()
  private val stableIds = mutableMapOf<String, Long>()
  private var nextId = 0L
  private var token: String? = null
  private fun dp(value: Double) = (value * resources.displayMetrics.density).roundToInt()
  private val manager = LinearLayoutManager(react)
  private val renderer = Renderer()

  init {
    layoutManager = manager
    itemAnimator = null
    isVerticalScrollBarEnabled = false
    renderer.setHasStableIds(true)
    adapter = renderer
  }

  fun install(window: ReadableMap?) {
    if (window == null) {
      rows = emptyList()
      token = null
      stableIds.clear()
      renderer.notifyDataSetChanged()
      return
    }
    val data = requireNotNull(window.getArray("rows"))
    val first = manager.findFirstVisibleItemPosition()
    val key = rows.getOrNull(first)?.key
    val top = manager.findViewByPosition(first)?.top ?: paddingTop
    val previous = token
    token = window.getString("scope")
    val newRows = List(data.size()) { index ->
      val item = requireNotNull(data.getMap(index))
      Row(requireNotNull(item.getString("key")), requireNotNull(item.getString("kind")), requireNotNull(item.getMap("model")))
    }
    if (previous != token) stableIds.clear()
    for (row in newRows) stableIds.getOrPut(row.key) { nextId++ }
    rows = newRows
    setPadding(0, 0, 0, 0)
    renderer.notifyDataSetChanged()
    val anchor = if (previous == token && key != null) rows.indexOfFirst { it.key == key } else -1
    manager.scrollToPositionWithOffset(anchor.coerceAtLeast(0), if (anchor >= 0) top - paddingTop else 0)
  }

  private inner class Renderer : Adapter<Holder>() {
    override fun getItemCount() = rows.size
    override fun getItemId(position: Int) = stableIds.getValue(rows[position].key)
    override fun getItemViewType(position: Int) = when (rows[position].kind) {
      "paragraph" -> 0
      "list" -> 1
      "table" -> 2
      else -> error("Unknown diagnostic range")
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
      val frame = FrameLayout(react).apply { layoutParams = LayoutParams(-1, -2) }
      val holder = when (viewType) {
        0 -> Paragraph(frame)
        1 -> ListGroup(frame)
        else -> Table(frame)
      }
      frame.addView(holder.content, FrameLayout.LayoutParams(-1, -2))
      return holder
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
      Trace.beginSection("cw.lab.native.bind")
      try {
        val model = rows[position].model
        holder.bind(model)
        holder.frame.setPadding(0, 0, 0, if (position + 1 == rows.size) 0 else dp(model.getDouble("gapAfter")))
      } finally { Trace.endSection() }
    }
  }
  private abstract class Holder(val frame: FrameLayout) : ViewHolder(frame) {
    abstract val content: View
    abstract fun bind(model: ReadableMap)
  }
  private inner class Paragraph(frame: FrameLayout) : Holder(frame) {
    override val content = TextView(react).apply {
      setPadding(0, 0, 0, 0)
      setTextIsSelectable(true)
      breakStrategy = Layout.BREAK_STRATEGY_HIGH_QUALITY
      hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
    }
    override fun bind(model: ReadableMap) {
      content.typeface = ReactFontManager.getInstance().getTypeface(requireNotNull(model.getString("font")), Typeface.NORMAL, react.assets)
      content.setTextSize(TypedValue.COMPLEX_UNIT_PX, ceil(model.getDouble("fontSize") * resources.displayMetrics.density).toFloat())
      content.setTextColor(Color.parseColor(model.getString("textColor")))
      val lineHeight = ceil(model.getDouble("lineHeight") * resources.displayMetrics.density).toInt()
      val value = SpannableString(model.getString("text"))
      value.setSpan(CssLineHeight(lineHeight), 0, value.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      content.text = value
    }
  }
  private inner class ListGroup(frame: FrameLayout) : Holder(frame) {
    override val content = MarkdownListText(react)
    override fun bind(model: ReadableMap) = content.bind(model)
  }
  private inner class Table(frame: FrameLayout) : Holder(frame) {
    private val shell = FrameLayout(react)
    private val grid = MarkdownTableGrid(react) { view, actual ->
      if (actual > 0 && view.layoutParams?.height != actual) view.post {
        if (view.height == actual || view.parent == null) return@post
        view.layoutParams = view.layoutParams.apply { height = actual }
      }
    }
    override val content = HorizontalScrollView(react).apply {
      isHorizontalScrollBarEnabled = true
      addView(shell)
      shell.addView(grid)
    }
    override fun bind(model: ReadableMap) {
      val border = dp(model.getDouble("borderWidth"))
      val width = dp(model.getDouble("width"))
      val height = dp(model.getDouble("height"))
      shell.background = GradientDrawable().apply {
        setColor(Color.TRANSPARENT)
        cornerRadius = dp(model.getDouble("radius")).toFloat()
        setStroke(border, Color.parseColor(model.getString("borderColor")))
      }
      shell.clipToOutline = true
      shell.minimumWidth = width
      shell.setPadding(border, border, border, border)
      grid.layoutParams = FrameLayout.LayoutParams(width, height)
      grid.bind(model)
      content.scrollTo(0, 0)
    }
  }
}

// Android TextView.setLineHeight adds space between baselines only. The Fabric
// text renderer also divides leading above/below the first and last line box.
private class CssLineHeight(private val pixels: Int) : LineHeightSpan {
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanStartV: Int, v: Int, fm: Paint.FontMetricsInt) {
    val half = (pixels - fm.descent + fm.ascent) / 2.0
    fm.ascent -= ceil(half).toInt()
    fm.descent += floor(half).toInt()
    if (start == 0) fm.top = fm.ascent
    if (end == text.length) fm.bottom = fm.descent
  }
}
