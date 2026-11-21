package dev.codewide.app.rendering

import android.view.View
import android.widget.TextView
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MarkdownTableGridTest {
  @Test fun wrapsAtTheAllocatedWidthAndReturnsToSingleLineHeight() {
    val reported = mutableListOf<Int>()
    val view = MarkdownTableGrid(RuntimeEnvironment.getApplication()) { _, height -> reported.add(height) }
    val caption = "This row has enough words to span several lines at a narrow width"
    view.bind(grid("Left", "Right", caption, "B", "Tail", "C"))
    place(view, 150)
    val wrapped = view.getChildAt(2) as TextView
    assertTrue(wrapped.lineCount > 1)
    val narrowHeight = reported.last()
    assertEquals(wrapped.bottom + 1, view.getChildAt(4).top)
    assertEquals(view.getChildAt(4).bottom + 1, narrowHeight)

    place(view, 1600)
    assertEquals(1, wrapped.lineCount)
    assertTrue(reported.last() < narrowHeight)
    assertEquals(view.getChildAt(4).bottom + 1, reported.last())
    place(view, 150)
    assertEquals(narrowHeight, reported.last())

    view.bind(grid("New", "Title", "One", "Two"))
    place(view, 150)
    assertEquals(4, view.childCount)
    assertEquals("One", (view.getChildAt(2) as TextView).text)
    assertEquals(view.getChildAt(2).bottom + 1, reported.last())
  }

  @Test fun exposesCellTextHeadingAndCoordinates() {
    val view = MarkdownTableGrid(RuntimeEnvironment.getApplication()) { _, _ -> }
    view.bind(grid("Name", "Value", "", "🌱"))
    place(view, 400)
    val tableInfo = view.createAccessibilityNodeInfo().collectionInfo
    assertEquals(2, tableInfo.rowCount)
    assertEquals(2, tableInfo.columnCount)
    assertTrue(view.getChildAt(1).isAccessibilityHeading)
    val last = view.getChildAt(3).createAccessibilityNodeInfo()
    assertEquals("🌱", last.text)
    assertEquals(1, last.collectionItemInfo.rowIndex)
    assertEquals(1, last.collectionItemInfo.columnIndex)
  }

  private fun grid(vararg cells: String) = JavaOnlyMap.of(
    "alignments", JavaOnlyArray.of("left", "right"), "cells", JavaOnlyArray.from(cells.toList()),
    "rowCount", cells.size / 2, "fontSize", 14.0, "lineHeight", 20.0,
    "paddingX", 6.0, "paddingY", 2.0, "stroke", 1.0, "font", "sans-serif",
    "headerFont", "sans-serif-medium", "textColor", "#ffffff", "ruleColor", "#343434",
    "headerColor", "#202020",
  )

  private fun place(view: MarkdownTableGrid, width: Int) {
    view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(500, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, width, 500)
  }
}
