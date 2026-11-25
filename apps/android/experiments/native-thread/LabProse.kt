package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Trace
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.*
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.react.bridge.*
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import kotlin.math.ceil
import kotlin.math.roundToInt

private data class PreparedParagraph(
  val body: Spanned,
  val font: Typeface,
  val size: Int,
  val top: Int,
  val height: Int,
)

private data class Group(val paragraphs: List<PreparedParagraph>, val width: Int, val height: Int)

// React Native's CustomStyleSpan enables both flags while measuring and drawing a styled run.
// Match that paint policy so character advance and glyph edges are comparable in this experiment.
private class ProseFontSpan(private val face: Typeface) : MetricAffectingSpan() {
  override fun updateDrawState(paint: TextPaint) = applyFont(paint)

  override fun updateMeasureState(paint: TextPaint) = applyFont(paint)

  private fun applyFont(paint: TextPaint) {
    paint.typeface = face
    paint.isSubpixelText = true
    paint.isLinearText = true
  }
}

// This store lives only in the one-thread, immutable fixture APK. A full cache rejects further
// preparations; a mounted or pending layout can never refer to a recycled handle.
private object PreparedProse {
  private val groups = mutableListOf<Group>()

  @Synchronized
  fun add(group: Group): Int {
    if (groups.size == 256) return -1
    groups.add(group)
    return groups.lastIndex
  }

  @Synchronized fun read(id: Int): Group? = groups.getOrNull(id)
}

private class ParagraphHeight(private val pixels: Int) : LineHeightSpan {
  override fun chooseHeight(
    s: CharSequence,
    start: Int,
    end: Int,
    spanStart: Int,
    v: Int,
    fm: Paint.FontMetricsInt,
  ) {
    val leading = pixels - (fm.descent - fm.ascent)
    fm.ascent -= ceil(leading / 2.0).toInt()
    fm.descent += kotlin.math.floor(leading / 2.0).toInt()
    if (start == 0) fm.top = fm.ascent
    if (end == s.length) fm.bottom = fm.descent
  }
}

class LabProseModule(private val react: ReactApplicationContext) :
  ReactContextBaseJavaModule(react) {
  override fun getName() = "CodeWideLabProseLayout"

  // Prepare off the Android UI thread during the JS render. Yoga sees the final dimensions on
  // the first commit. The host receives just a handle to the prebuilt spans.
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun prepare(model: ReadableMap): WritableMap? {
    Trace.beginSection("cw.prose.prepare")
    try {
      val density = react.resources.displayMetrics.density
      val width = (model.getDouble("width") * density).roundToInt().coerceAtLeast(1)
      val blocks = requireNotNull(model.getArray("blocks"))
      val gap = model.getDouble("gap") * density
      val paragraphs = ArrayList<PreparedParagraph>(blocks.size())
      var nextTop = 0.0
      for (index in 0 until blocks.size()) {
        val block = requireNotNull(blocks.getMap(index))
        if (index > 0) nextTop += gap
        nextTop += block.getDouble("margin") * density
        val top = nextTop.roundToInt()
        val size = ceil(block.getDouble("size") * density).toInt()
        val font = face(requireNotNull(block.getString("font")), false)
        val body = SpannableStringBuilder()
        val runs = requireNotNull(block.getArray("runs"))
        for (i in 0 until runs.size()) {
          val run = requireNotNull(runs.getMap(i))
          val start = body.length
          body.append(run.getString("text"))
          if (start == body.length) continue
          fun span(style: Any) =
            body.setSpan(style, start, body.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          span(ProseFontSpan(face(requireNotNull(run.getString("font")), run.getBoolean("italic"))))
          span(ForegroundColorSpan(Color.parseColor(run.getString("color"))))
          if (run.getBoolean("strike")) span(StrikethroughSpan())
          if (run.getBoolean("underline")) span(UnderlineSpan())
          if (run.getBoolean("code"))
            span(BackgroundColorSpan(Color.parseColor(model.getString("codeColor"))))
          if (run.getBoolean("icon"))
            span(AbsoluteSizeSpan(ceil(model.getDouble("iconSize") * density).toInt()))
        }
        body.setSpan(
          ParagraphHeight(ceil(block.getDouble("lineHeight") * density).toInt()),
          0,
          body.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        val paint =
          TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font
            textSize = size.toFloat()
            this.density = density
          }
        val layout =
          StaticLayout.Builder.obtain(body, 0, body.length, paint, width)
            .setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY)
            .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
            .setIncludePad(true)
            .build()
        paragraphs.add(PreparedParagraph(body, font, size, top, layout.height))
        nextTop += layout.height
      }
      val height = nextTop.roundToInt()
      val id = PreparedProse.add(Group(paragraphs, width, height))
      if (id < 0) return null
      return Arguments.createMap().apply {
        putInt("id", id)
        putDouble("height", height / density.toDouble())
      }
    } finally {
      Trace.endSection()
    }
  }

  private fun face(name: String, italic: Boolean): Typeface {
    val style = if (italic) Typeface.ITALIC else Typeface.NORMAL
    return ReactFontManager.getInstance().getTypeface(name, style, react.assets)
  }
}

class LabProseManager : SimpleViewManager<LabProseView>() {
  override fun getName() = "CodeWideLabProse"

  override fun createViewInstance(context: ThemedReactContext) = LabProseView(context)

  @ReactProp(name = "prepared", defaultInt = -1)
  fun prepared(view: LabProseView, id: Int) = view.bind(id)
}

class LabProseView(context: Context) : ViewGroup(context) {
  private var group: Group? = null

  fun bind(id: Int) {
    val next = PreparedProse.read(id)
    if (group === next) return
    Trace.beginSection("cw.prose.bind")
    try {
      group = next
      removeAllViews()
      next?.paragraphs?.forEach { row ->
        addView(
          TextView(context).apply {
            setPadding(0, 0, 0, 0)
            typeface = row.font
            setTextSize(TypedValue.COMPLEX_UNIT_PX, row.size.toFloat())
            setTextIsSelectable(true)
            breakStrategy = Layout.BREAK_STRATEGY_HIGH_QUALITY
            hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
            text = row.body
          }
        )
      }
      requestLayout()
      if (width > 0) position()
    } finally {
      Trace.endSection()
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = position()

  private fun position() {
    val value = group ?: return
    value.paragraphs.forEachIndexed { index, row ->
      val child = getChildAt(index)
      child.measure(
        View.MeasureSpec.makeMeasureSpec(value.width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(row.height, View.MeasureSpec.EXACTLY),
      )
      child.layout(0, row.top, value.width, row.top + row.height)
    }
  }
}
