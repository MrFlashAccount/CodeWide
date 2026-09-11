package dev.codewide.app.rendering

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

class NativeStreamingRevealManager : ViewGroupManager<NativeStreamingRevealView>() {
  override fun getName(): String = "CodeWideStreamingReveal"
  override fun createViewInstance(context: ThemedReactContext) = NativeStreamingRevealView(context)

  @ReactProp(name = "streamKey")
  fun setStreamKey(view: NativeStreamingRevealView, value: String?) = view.setStreamKey(value)

  @ReactProp(name = "reduceMotion", defaultBoolean = false)
  fun setReduceMotion(view: NativeStreamingRevealView, value: Boolean) = view.setReduceMotion(value)

  @ReactProp(name = "animateNew", defaultBoolean = true)
  fun setAnimateNew(view: NativeStreamingRevealView, value: Boolean) = view.setAnimateNew(value)

  override fun onDropViewInstance(view: NativeStreamingRevealView) {
    view.release()
    super.onDropViewInstance(view)
  }
}
