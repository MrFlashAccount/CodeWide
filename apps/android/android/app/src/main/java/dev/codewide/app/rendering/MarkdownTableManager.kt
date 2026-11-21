package dev.codewide.app.rendering

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

class MarkdownTableManager : SimpleViewManager<MarkdownTableGrid>() {
  override fun getName() = "CodeWideMarkdownTable"

  override fun createViewInstance(context: ThemedReactContext) =
    MarkdownTableGrid(context) { view, pixels ->
      val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, view.id)
      val height = pixels / view.resources.displayMetrics.density.toDouble()
      dispatcher?.dispatchEvent(TableHeightEvent(UIManagerHelper.getSurfaceId(context), view.id, height))
    }

  @ReactProp(name = "grid")
  fun setGrid(view: MarkdownTableGrid, grid: ReadableMap?) = view.bind(grid)

  override fun getExportedCustomDirectEventTypeConstants() = mutableMapOf<String, Any>(
    "topTableHeight" to mapOf("registrationName" to "onTableHeight"),
  )
}

private class TableHeightEvent(surface: Int, tag: Int, private val height: Double) :
  Event<TableHeightEvent>(surface, tag) {
  override fun getEventName() = "topTableHeight"
  override fun getEventData() = Arguments.createMap().apply { putDouble("height", height) }
}
