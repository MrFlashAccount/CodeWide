package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.roundToInt

/** The horizontal viewport belongs to React. Android wraps and measures cells at its allocated width. */
class MarkdownTableGrid(
  context: Context,
  private val onHeight: (MarkdownTableGrid, Int) -> Unit,
) : ViewGroup(context) {
  private var columns = 0
  private var heights = IntArray(0)
  private var stroke = 0
  private var estimatedHeight = 0
  private var reportedHeight = 0
  private val rule = Paint()
  private val header = Paint()

  init { setWillNotDraw(false) }

  fun bind(grid: ReadableMap?) {
    val cells = grid?.getArray("cells")
    val alignments = grid?.getArray("alignments")
    if (grid == null || cells == null || alignments == null || alignments.size() == 0) {
      removeAllViews()
      heights = IntArray(0)
      columns = 0
      reportedHeight = 0
      invalidate()
      return
    }
    columns = alignments.size()
    val rows = grid.getInt("rowCount")
    require(rows > 0 && rows.toLong() * columns == cells.size().toLong())
    if (heights.size != rows) heights = IntArray(rows)
    val density = resources.displayMetrics.density
    fun pixels(key: String) = (grid.getDouble(key) * density).roundToInt()
    val lineHeight = pixels("lineHeight")
    val paddingX = pixels("paddingX")
    val paddingY = pixels("paddingY")
    val fontSize = grid.getDouble("fontSize").toFloat()
    val textColor = Color.parseColor(grid.getString("textColor"))
    header.color = Color.parseColor(grid.getString("headerColor"))
    rule.color = Color.parseColor(grid.getString("ruleColor"))
    stroke = pixels("stroke")
    val fonts = ReactFontManager.getInstance()
    fun font(key: String) = fonts.getTypeface(requireNotNull(grid.getString(key)), Typeface.NORMAL, context.assets)
    val regular = font("font")
    val bold = font("headerFont")
    val minCellHeight = lineHeight + 2 * paddingY
    estimatedHeight = rows * (minCellHeight + stroke)
    if (childCount > cells.size()) removeViews(cells.size(), childCount - cells.size())
    for (index in 0 until cells.size()) {
      val cell = getChildAt(index) as? TableCellText ?: TableCellText(context).also { addView(it) }
      val row = index / columns
      val column = index % columns
      cell.row = row
      cell.column = column
      cell.typeface = if (row == 0) bold else regular
      cell.setTextSize(TypedValue.COMPLEX_UNIT_DIP, fontSize)
      cell.lineHeight = lineHeight
      cell.minHeight = minCellHeight
      cell.setTextColor(textColor)
      cell.setPadding(paddingX, paddingY, paddingX + stroke, paddingY)
      cell.isAccessibilityHeading = row == 0
      val horizontal = when (alignments.getString(column)) {
        "center" -> Gravity.CENTER_HORIZONTAL
        "right" -> Gravity.RIGHT
        else -> Gravity.LEFT
      }
      cell.gravity = Gravity.CENTER_VERTICAL or horizontal
      cell.text = cells.getString(index)
    }
    // Fabric can update a mounted grid without changing its outer frame.
    if (isLaidOut && width > 0) layoutCells(width)
    requestLayout()
    invalidate()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (width > 0) layoutCells(width)
  }

  private fun layoutCells(availableWidth: Int) {
    var y = 0
    for (row in heights.indices) {
      var height = 0
      for (column in 0 until columns) {
        val cell = getChildAt(row * columns + column)
        val position = if (layoutDirection == LAYOUT_DIRECTION_RTL) columns - column - 1 else column
        val left = position * availableWidth / columns
        val right = (position + 1) * availableWidth / columns
        cell.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.UNSPECIFIED)
        cell.layout(left, y, right, y + cell.measuredHeight)
        height = maxOf(height, cell.measuredHeight)
      }
      heights[row] = height
      y += height + stroke
    }
    // Yoga owns the single-line estimate until the first correction. Once corrected,
    // JS uses the last reported height even when the table later returns to one-line rows.
    if (y > 0 && y != reportedHeight && (reportedHeight != 0 || y != estimatedHeight)) {
      reportedHeight = y
      onHeight(this, y)
    }
  }

  override fun onDraw(canvas: Canvas) {
    if (heights.isEmpty()) return
    canvas.drawRect(0f, 0f, width.toFloat(), heights.first().toFloat(), header)
    var y = 0
    for (height in heights) {
      y += height
      canvas.drawRect(0f, y.toFloat(), width.toFloat(), (y + stroke).toFloat(), rule)
      y += stroke
    }
    for (column in 1..columns) {
      val x = column * width / columns
      canvas.drawRect((x - stroke).toFloat(), 0f, x.toFloat(), y.toFloat(), rule)
    }
  }

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.collectionInfo = AccessibilityNodeInfo.CollectionInfo.obtain(heights.size, columns, false)
  }
}

private class TableCellText(context: Context) : TextView(context) {
  var row = 0
  var column = 0
  init { includeFontPadding = false }

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.collectionItemInfo = AccessibilityNodeInfo.CollectionItemInfo.obtain(row, 1, column, 1, isAccessibilityHeading)
  }
}
