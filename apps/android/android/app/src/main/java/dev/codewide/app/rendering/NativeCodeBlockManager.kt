package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeCodeBlockManager : SimpleViewManager<NativeCodeBlockView>() {
  override fun getName(): String = "CodexNativeCodeBlock"

  override fun createViewInstance(reactContext: ThemedReactContext): NativeCodeBlockView =
    NativeCodeBlockView(reactContext)

  @ReactProp(name = "code")
  fun setCode(view: NativeCodeBlockView, value: String?) = view.setCode(value)

  @ReactProp(name = "language")
  fun setLanguage(view: NativeCodeBlockView, value: String?) = view.setLanguage(value)

  @ReactProp(name = "variant")
  fun setVariant(view: NativeCodeBlockView, value: String?) = view.setVariant(value)

  @ReactProp(name = "maxLines", defaultInt = 0)
  fun setMaxLines(view: NativeCodeBlockView, value: Int) = view.setMaximumLines(value)

  override fun onAfterUpdateTransaction(view: NativeCodeBlockView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  override fun onDropViewInstance(view: NativeCodeBlockView) {
    view.release()
    super.onDropViewInstance(view)
  }
}
