package dev.codewide.app.rendering

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

class NativeRevealManager : ViewGroupManager<NativeRevealView>() {
  override fun getName(): String = "CodexRevealSurface"

  override fun createViewInstance(reactContext: ThemedReactContext): NativeRevealView =
    NativeRevealView(reactContext)

  @ReactProp(name = "ready", defaultBoolean = true)
  fun setReady(view: NativeRevealView, value: Boolean) = view.setPendingReady(value)

  @ReactProp(name = "reduceMotion", defaultBoolean = false)
  fun setReduceMotion(view: NativeRevealView, value: Boolean) = view.setPendingReduceMotion(value)

  @ReactProp(name = "revealKey")
  fun setRevealKey(view: NativeRevealView, value: String?) = view.setPendingRevealKey(value)

  override fun onAfterUpdateTransaction(view: NativeRevealView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  override fun onDropViewInstance(view: NativeRevealView) {
    view.release()
    super.onDropViewInstance(view)
  }
}
