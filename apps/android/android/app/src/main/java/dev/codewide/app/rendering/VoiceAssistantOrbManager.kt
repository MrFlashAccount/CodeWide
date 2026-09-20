package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** Exposes the shared renderer slot to in-app React surfaces. */
class VoiceAssistantOrbManager : SimpleViewManager<VoiceAssistantOrbSlotView>() {
  override fun getName(): String = "CodeWideVoiceAssistantOrb"

  override fun createViewInstance(reactContext: ThemedReactContext): VoiceAssistantOrbSlotView =
    VoiceAssistantOrbSlotView(reactContext)

  @ReactProp(name = "level", defaultDouble = -1.0)
  fun setLevel(view: VoiceAssistantOrbSlotView, level: Double) {
    view.setLevel(level)
  }

  @ReactProp(name = "orbState")
  fun setOrbState(view: VoiceAssistantOrbSlotView, state: String?) {
    view.setOrbState(VoiceAssistantOrbState.fromWireValue(state.orEmpty()))
  }

  @ReactProp(name = "orbStyle")
  fun setOrbStyle(view: VoiceAssistantOrbSlotView, style: String?) {
    view.setOrbStyle(VoiceAssistantOrbStyle.fromWireValue(style.orEmpty()))
  }

  @ReactProp(name = "reducedMotion", defaultBoolean = false)
  fun setReducedMotion(view: VoiceAssistantOrbSlotView, reducedMotion: Boolean) {
    view.setReducedMotion(reducedMotion)
  }
}
