package dev.codewide.app.perfetto

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

internal class PerfettoTimelineManager : SimpleViewManager<PerfettoInspectorView>() {
  override fun getName() = "CodeWidePerfettoViewer"

  override fun createViewInstance(context: ThemedReactContext) = PerfettoInspectorView(context)

  @ReactProp(name = "sourceUri")
  fun source(view: PerfettoInspectorView, uri: String?) = view.setSource(uri)

  override fun onDropViewInstance(view: PerfettoInspectorView) {
    view.setSource(null)
    super.onDropViewInstance(view)
  }
}
