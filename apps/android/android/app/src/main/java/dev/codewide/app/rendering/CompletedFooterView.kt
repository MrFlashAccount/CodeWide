package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.roundToInt

/** A full-width completed footer is a single Fabric leaf. Its Android children retain independent
 * accessibility and click targets. Width changes are resolved before drawing, in the same layout. */
class CompletedFooterView(
  context: Context,
  onPricePress: (CompletedFooterView, Rect) -> Unit,
) : ViewGroup(context) {
  private val density = resources.displayMetrics.density
  private val dot = View(context)
  private val duration = label()
  private val tokens = label()
  private val price = object : TextView(context) {
    override fun drawableStateChanged() {
      super.drawableStateChanged()
      alpha = if (isPressed) 0.68f else 1f
    }
  }.apply { configureLabel(this) }
  private val time = label()
  private val tokenSeparator = separator()
  private val priceSeparator = separator()
  private val labels = listOf(duration, tokens, price, time, tokenSeparator, priceSeparator)
  private var inset = 0
  private var dotGap = 0
  private var separatorGap = 0
  private var dotSize = 0
  private var touchPadding = 0

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    dot.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    addView(dot)
    addView(duration)
    addView(tokenSeparator)
    addView(tokens)
    addView(priceSeparator)
    addView(price)
    addView(time)
    price.isFocusable = true
    price.setOnClickListener {
      onPricePress(this, Rect(price.left, price.top, price.right, price.bottom))
    }
    price.accessibilityDelegate = object : AccessibilityDelegate() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        info.className = android.widget.Button::class.java.name
        info.hintText = "Shows the token cost breakdown"
      }
    }
  }

  private fun label() = TextView(context).also(::configureLabel)

  private fun configureLabel(view: TextView) = with(view) {
    setSingleLine()
    gravity = Gravity.CENTER_VERTICAL
    includeFontPadding = false
    setPadding(0, 0, 0, 0)
  }

  private fun separator() = label().apply {
    text = "·"
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  fun applyTheme(theme: ReadableMap) {
    val family = theme.string("font")
    if (family.isEmpty()) return
    val face = ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, context.assets)
    val pixels = (theme.number("textSize") * density).toFloat()
    val muted = theme.number("muted").toLong().toInt()
    val dim = theme.number("dim").toLong().toInt()
    for (v in labels) {
      v.typeface = face
      v.setTextSize(TypedValue.COMPLEX_UNIT_PX, pixels)
      v.setTextColor(if (v === time || v === tokenSeparator || v === priceSeparator) dim else muted)
    }
    time.fontFeatureSettings = "tnum"
    dot.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(theme.number("success").toLong().toInt())
    }
    inset = dp(theme.number("inset"))
    dotSize = dp(theme.number("dotSize"))
    dotGap = dp(theme.number("dotGap"))
    separatorGap = dp(theme.number("separatorGap"))
    touchPadding = dp(theme.number("touchPadding"))
    relayout()
  }

  fun applyContent(content: ReadableMap) {
    dot.contentDescription = content.string("status")
    duration.text = content.string("duration")
    tokens.text = content.string("tokens")
    tokens.contentDescription = content.string("tokenLabel")
    price.text = content.string("price")
    price.contentDescription = content.string("priceLabel")
    time.text = content.string("time")
    relayout()
  }

  // Fabric owns this leaf's external bounds. Updated labels can change child bounds without a Yoga resize.
  private fun relayout() {
    requestLayout()
    if (width > 0 && height > 0) {
      measureChildrenForRow(height)
      layoutChildren(width, height)
    }
  }

  private fun measureChildrenForRow(rowHeight: Int) {
    val unbounded = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    // TextView centers its line using its measured height, including after a content-only update.
    val heightSpec = MeasureSpec.makeMeasureSpec(rowHeight, MeasureSpec.EXACTLY)
    for (v in labels) {
      v.measure(unbounded, heightSpec)
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val rowHeight = MeasureSpec.getSize(heightMeasureSpec)
    measureChildrenForRow(rowHeight)
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), rowHeight)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = layoutChildren(r - l, b - t)

  private fun layoutChildren(width: Int, height: Int) {
    val durationWidth = if (duration.text.isEmpty()) 0 else dotGap + duration.measuredWidth
    val timeX = width - inset - time.measuredWidth
    val rest = timeX - inset - (inset + dotSize + durationWidth)
    val costWidth = price.measuredWidth + priceSeparator.measuredWidth + 2 * separatorGap
    val tokenWidth = tokens.measuredWidth + tokenSeparator.measuredWidth + 2 * separatorGap
    val showPrice = costWidth <= rest
    val showTokens = tokens.text.isNotEmpty() && tokenWidth + costWidth <= rest
    val top = (height - dotSize) / 2
    dot.layout(inset, top, inset + dotSize, top + dotSize)
    place(duration, inset + dotSize + dotGap, height, durationWidth > 0)
    var x = inset + dotSize + durationWidth
    fun part(separator: TextView, label: TextView, visible: Boolean) {
      place(separator, x + separatorGap, height, visible)
      val start = x + separatorGap * 2 + separator.measuredWidth
      place(label, start, height, visible)
      if (visible) x = start + label.measuredWidth
    }
    part(tokenSeparator, tokens, showTokens)
    part(priceSeparator, price, showPrice)
    place(time, timeX, height, true)
    touchDelegate = if (showPrice) android.view.TouchDelegate(
      android.graphics.Rect(price.left - touchPadding, 0, price.right + touchPadding, height), price
    ) else null
  }

  private fun place(view: View, x: Int, height: Int, show: Boolean) {
    view.visibility = if (show) VISIBLE else INVISIBLE
    view.layout(x, 0, x + view.measuredWidth, height)
  }

  private fun dp(value: Double) = (value * density).roundToInt()
  private fun ReadableMap.string(key: String): String =
    if (hasKey(key) && getType(key) == ReadableType.String) getString(key).orEmpty() else ""
  private fun ReadableMap.number(key: String): Double =
    if (hasKey(key) && getType(key) == ReadableType.Number) getDouble(key) else 0.0

}
