package dev.codewide.app.rendering

import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.IllegalViewOperationException

/** Fences React attachment commands and reconciles late-mounted text descendants. */
class TextShimmerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val registry = TextShimmerRegistry(::resolveNativeView) { view ->
    textShimmerDrawable(view)?.let(::TextShimmerAttachment)
  }
  private val uiManagers = mutableSetOf<UIManager>()
  private var invalidated = false
  @OptIn(UnstableReactNativeAPI::class)
  private val listener = object : UIManagerListener {
    override fun willDispatchViewUpdates(uiManager: UIManager) { context.runOnUiQueueThread { registry.reconcile() } }
    override fun willMountItems(uiManager: UIManager) = Unit
    override fun didMountItems(uiManager: UIManager) { registry.reconcile() }
    override fun didDispatchMountItems(uiManager: UIManager) = Unit
    override fun didScheduleMountItems(uiManager: UIManager) = Unit
  }
  override fun getName(): String = "CodeWideTextShimmer"

  @ReactMethod fun attach(reactTag: Double, token: String) {
    val tag = validatedTag(reactTag, token) ?: return
    context.runOnUiQueueThread {
      if (invalidated) return@runOnUiQueueThread
      UIManagerHelper.getUIManagerForReactTag(context, tag)?.let(::observe)
      registry.attach(tag, token)
    }
  }

  @ReactMethod fun detach(reactTag: Double, token: String) {
    val tag = validatedTag(reactTag, token) ?: return
    context.runOnUiQueueThread {
      registry.detach(tag, token)
      if (!registry.hasRequests) stopObserving()
    }
  }

  @OptIn(UnstableReactNativeAPI::class)
  private fun observe(manager: UIManager) { if (uiManagers.add(manager)) manager.addUIManagerEventListener(listener) }
  @OptIn(UnstableReactNativeAPI::class)
  private fun stopObserving() { uiManagers.forEach { it.removeUIManagerEventListener(listener) }; uiManagers.clear() }
  private fun resolveNativeView(tag: Int): View? {
    val manager = UIManagerHelper.getUIManagerForReactTag(context, tag) ?: return null
    return try { manager.resolveView(tag) }
    // A React commit can precede its Fabric mount or race its unmount.
    catch (_: IllegalViewOperationException) { null }
  }
  override fun invalidate() {
    context.runOnUiQueueThread { invalidated = true; registry.release(); stopObserving() }
    super.invalidate()
  }

  private fun validatedTag(reactTag: Double, token: String): Int? =
    if (reactTag.isFinite() && reactTag > 0 && reactTag <= Int.MAX_VALUE && reactTag % 1 == 0.0 && token.isNotBlank()) reactTag.toInt()
    else null
}
