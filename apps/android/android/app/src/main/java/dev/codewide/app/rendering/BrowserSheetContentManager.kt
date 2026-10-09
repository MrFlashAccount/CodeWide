package dev.codewide.app.rendering

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewManager

/** Browser-only touch boundary; other sheets retain their normal scrolling handoff. */
class BrowserSheetContentManager : ReactViewManager() {
  override fun getName(): String = "CodeWideBrowserSheetContent"

  override fun createViewInstance(context: ThemedReactContext): BrowserSheetContentView =
    BrowserSheetContentView(context)
}
