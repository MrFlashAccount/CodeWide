package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeShimmerTextManager : SimpleViewManager<NativeShimmerTextView>() {
  override fun getName(): String = "CodexShimmerText"

  override fun createViewInstance(reactContext: ThemedReactContext): NativeShimmerTextView =
    NativeShimmerTextView(reactContext)

  @ReactProp(name = "text")
  fun setText(view: NativeShimmerTextView, value: String?) = view.setPendingText(value)

  @ReactProp(name = "color", customType = "Color")
  fun setColor(view: NativeShimmerTextView, value: Int?) = view.setPendingColor(value)

  @ReactProp(name = "fontSize", defaultFloat = 14f)
  fun setFontSize(view: NativeShimmerTextView, value: Float) = view.setPendingFontSize(value)

  @ReactProp(name = "fontFamily")
  fun setFontFamily(view: NativeShimmerTextView, value: String?) = view.setPendingFontFamily(value)

  @ReactProp(name = "fontWeight")
  fun setFontWeight(view: NativeShimmerTextView, value: String?) = view.setPendingFontWeight(value)

  @ReactProp(name = "lineHeight")
  fun setLineHeight(view: NativeShimmerTextView, value: Float) = view.setPendingLineHeight(value)

  @ReactProp(name = "numberOfLines")
  fun setNumberOfLines(view: NativeShimmerTextView, value: Int) = view.setPendingNumberOfLines(value)

  @ReactProp(name = "textAlign")
  fun setTextAlign(view: NativeShimmerTextView, value: String?) = view.setPendingTextAlign(value)

  @ReactProp(name = "animate", defaultBoolean = true)
  fun setAnimate(view: NativeShimmerTextView, value: Boolean) = view.setPendingAnimate(value)

  override fun onAfterUpdateTransaction(view: NativeShimmerTextView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  override fun onDropViewInstance(view: NativeShimmerTextView) {
    view.release()
    super.onDropViewInstance(view)
  }
}
