package dev.codewide.app.rendering

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

// This is a full React View with drawing-only animation, not a bare ViewGroup:
// inherit the same border/radius/overflow handling as the nonanimated bubbles.
class NativeFluidLayoutManager : ReactViewManager() {
  override fun getName(): String = "CodeWideFluidLayout"
  override fun createViewInstance(context: ThemedReactContext): NativeFluidLayoutView = NativeFluidLayoutView(context)

  @ReactProp(name = "animate", defaultBoolean = false)
  fun setAnimate(view: ReactViewGroup, value: Boolean) {
    require(view is NativeFluidLayoutView)
    view.setAnimate(value)
  }

  override fun onDropViewInstance(view: ReactViewGroup) {
    require(view is NativeFluidLayoutView)
    view.finish()
    super.onDropViewInstance(view)
  }
}
