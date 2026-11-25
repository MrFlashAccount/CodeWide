package dev.codewide.app.rendering

import android.graphics.Rect
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class CompletedFooterManager : SimpleViewManager<CompletedFooterView>() {
  override fun getName() = "CodeWideCompletedFooter"
  override fun createViewInstance(reactContext: ThemedReactContext) = CompletedFooterView(reactContext) { view, bounds ->
    val event = PriceEvent(UIManagerHelper.getSurfaceId(reactContext), view.id, bounds, view.resources.displayMetrics.density)
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, view.id)?.dispatchEvent(event)
  }

  @ReactProp(name = "footerTheme")
  fun theme(view: CompletedFooterView, theme: ReadableMap?) { if (theme != null) view.applyTheme(theme) }

  @ReactProp(name = "footerContent")
  fun content(view: CompletedFooterView, content: ReadableMap?) { if (content != null) view.applyContent(content) }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
      put("topFooterPricePress", mapOf("registrationName" to "onFooterPricePress"))
    }

  private class PriceEvent(surfaceId: Int, viewId: Int, private val bounds: Rect, private val density: Float) : Event<PriceEvent>(surfaceId, viewId) {
    override fun getEventName() = "topFooterPricePress"
    override fun getEventData(): WritableMap = Arguments.createMap().apply {
      putDouble("x", (bounds.left / density).toDouble())
      putDouble("width", (bounds.width() / density).toDouble())
      putDouble("height", (bounds.height() / density).toDouble())
    }
  }
}
