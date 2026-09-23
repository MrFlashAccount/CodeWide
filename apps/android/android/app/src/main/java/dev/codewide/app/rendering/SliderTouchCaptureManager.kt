package dev.codewide.app.rendering

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewManager

/** Native view boundary for the slider's touch stream inside a Compose menu. */
class SliderTouchCaptureManager : ReactViewManager() {
  override fun getName(): String = "CodeWideSliderTouchCapture"

  override fun createViewInstance(context: ThemedReactContext): SliderTouchCaptureView =
    SliderTouchCaptureView(context)
}
