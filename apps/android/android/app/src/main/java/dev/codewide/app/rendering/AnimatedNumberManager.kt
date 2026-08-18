package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class AnimatedNumberManager : SimpleViewManager<AnimatedNumberView>() {
  override fun getName(): String = "CodexAnimatedNumber"

  override fun createViewInstance(reactContext: ThemedReactContext): AnimatedNumberView =
    AnimatedNumberView(reactContext)

  @ReactProp(name = "value")
  fun setValue(view: AnimatedNumberView, value: Double) = view.setPendingValue(value)

  @ReactProp(name = "formatStyle")
  fun setFormatStyle(view: AnimatedNumberView, value: String?) = view.setPendingFormatStyle(value)

  @ReactProp(name = "currency")
  fun setCurrency(view: AnimatedNumberView, value: String?) = view.setPendingCurrency(value)

  @ReactProp(name = "minimumFractionDigits", defaultInt = 0)
  fun setMinimumFractionDigits(view: AnimatedNumberView, value: Int) = view.setPendingMinimumFractionDigits(value)

  @ReactProp(name = "maximumFractionDigits", defaultInt = 3)
  fun setMaximumFractionDigits(view: AnimatedNumberView, value: Int) = view.setPendingMaximumFractionDigits(value)

  @ReactProp(name = "prefix")
  fun setPrefix(view: AnimatedNumberView, value: String?) = view.setPendingPrefix(value)

  @ReactProp(name = "suffix")
  fun setSuffix(view: AnimatedNumberView, value: String?) = view.setPendingSuffix(value)

  @ReactProp(name = "color", customType = "Color")
  fun setColor(view: AnimatedNumberView, value: Int?) = view.setPendingColor(value)

  @ReactProp(name = "fontSize", defaultFloat = 14f)
  fun setFontSize(view: AnimatedNumberView, value: Float) = view.setPendingFontSize(value)

  @ReactProp(name = "lineHeight", defaultFloat = 18f)
  fun setLineHeight(view: AnimatedNumberView, value: Float) = view.setPendingLineHeight(value)

  @ReactProp(name = "fontFamily")
  fun setFontFamily(view: AnimatedNumberView, value: String?) = view.setPendingFontFamily(value)

  @ReactProp(name = "fontWeight")
  fun setFontWeight(view: AnimatedNumberView, value: String?) = view.setPendingFontWeight(value)

  @ReactProp(name = "textAlign")
  fun setTextAlign(view: AnimatedNumberView, value: String?) = view.setPendingTextAlign(value)

  @ReactProp(name = "animate", defaultBoolean = true)
  fun setAnimate(view: AnimatedNumberView, value: Boolean) = view.setPendingAnimate(value)

  @ReactProp(name = "numberAccessibilityLabel")
  fun setNumberAccessibilityLabel(view: AnimatedNumberView, value: String?) = view.setPendingAccessibilityLabel(value)

  override fun onAfterUpdateTransaction(view: AnimatedNumberView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  override fun onDropViewInstance(view: AnimatedNumberView) {
    view.release()
    super.onDropViewInstance(view)
  }
}
