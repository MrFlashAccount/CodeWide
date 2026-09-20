package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** Exposes the shared native Nebula renderer to the in-app React surface. */
class NebulaOrbManager : SimpleViewManager<NebulaOrbView>() {
  override fun getName(): String = "CodeWideNebulaOrb"

  override fun createViewInstance(reactContext: ThemedReactContext): NebulaOrbView =
    NebulaOrbView(reactContext)

  @ReactProp(name = "level", defaultDouble = 0.0)
  fun setLevel(view: NebulaOrbView, level: Double) {
    view.setLevel(level)
  }
}
