package dev.codewide.app.rendering

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** Exposes the shared renderer slot to in-app React surfaces. */
class VoiceAssistantOrbManager : SimpleViewManager<VoiceAssistantOrbSlotView>() {
  override fun getName(): String = "CodeWideVoiceAssistantOrb"

  override fun createViewInstance(reactContext: ThemedReactContext): VoiceAssistantOrbSlotView =
    VoiceAssistantOrbSlotView(reactContext)

  @ReactProp(name = "inputLevel", defaultDouble = 0.0)
  fun setInputLevel(view: VoiceAssistantOrbSlotView, level: Double) {
    view.setInputLevel(level)
  }

  @ReactProp(name = "playbackLevel", defaultDouble = 0.0)
  fun setPlaybackLevel(view: VoiceAssistantOrbSlotView, level: Double) {
    view.setPlaybackLevel(level)
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
