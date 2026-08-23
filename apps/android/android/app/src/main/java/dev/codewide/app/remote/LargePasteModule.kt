package dev.codewide.app.remote

import android.text.Spanned
import android.widget.TextView
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import java.util.WeakHashMap

/**
 * Consumes opted-in large clipboard pastes before TextView splits or filters
 * them. JS receives the complete ClipData payload in one event.
 */
class LargePasteModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private data class Registration(val token: String, val minimumChars: Int)

  private val requested = mutableMapOf<Int, Registration>()
  private val installedViews = WeakHashMap<TextView, Registration>()
  private val observedUiManagers = mutableSetOf<UIManager>()
  @OptIn(UnstableReactNativeAPI::class)
  private val uiManagerListener = object : UIManagerListener {
    override fun willDispatchViewUpdates(uiManager: UIManager) {
      context.runOnUiQueueThread { installRequestedViews(uiManager) }
    }

    override fun willMountItems(uiManager: UIManager) = Unit

    override fun didMountItems(uiManager: UIManager) {
      installRequestedViews(uiManager)
    }

    override fun didDispatchMountItems(uiManager: UIManager) = Unit

    override fun didScheduleMountItems(uiManager: UIManager) = Unit
  }

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun install(reactTag: Double, token: String, minimumChars: Double) {
    val tag = reactTag.toInt()
    val threshold = minimumChars.toInt()
    if (tag <= 0 || token.isBlank() || threshold < 0) return
    val registration = Registration(token, threshold)
    context.runOnUiQueueThread {
      requested[tag] = registration
      val uiManager = UIManagerHelper.getUIManagerForReactTag(context, tag) ?: return@runOnUiQueueThread
      observe(uiManager)
      installResolvedView(uiManager, tag, registration)
    }
  }

  @ReactMethod
  fun uninstall(reactTag: Double, token: String) {
    val tag = reactTag.toInt()
    context.runOnUiQueueThread {
      if (requested[tag]?.token != token) return@runOnUiQueueThread
      requested.remove(tag)
      installedViews.entries
        .filter { it.value.token == token }
        .map { it.key }
        .forEach { view ->
          ViewCompat.setOnReceiveContentListener(view, null, null)
          installedViews.remove(view)
        }
      if (requested.isEmpty()) stopObservingUiManagers()
    }
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  @OptIn(UnstableReactNativeAPI::class)
  private fun observe(uiManager: UIManager) {
    if (observedUiManagers.add(uiManager)) uiManager.addUIManagerEventListener(uiManagerListener)
  }

  @OptIn(UnstableReactNativeAPI::class)
  private fun stopObservingUiManagers() {
    observedUiManagers.forEach { it.removeUIManagerEventListener(uiManagerListener) }
    observedUiManagers.clear()
  }

  private fun installRequestedViews(uiManager: UIManager) {
    requested.forEach { (tag, registration) ->
      if (UIManagerHelper.getUIManagerForReactTag(context, tag) === uiManager) {
        installResolvedView(uiManager, tag, registration)
      }
    }
  }

  private fun installResolvedView(uiManager: UIManager, tag: Int, registration: Registration) {
    if (requested[tag] != registration) return
    val view = resolveTextView(uiManager, tag) ?: return
    if (installedViews[view] == registration) return
    installedViews[view] = registration
    ViewCompat.setOnReceiveContentListener(
      view,
      arrayOf("text/*"),
      OnReceiveContentListener { _, content -> receiveContent(view, tag, registration, content) },
    )
  }

  private fun receiveContent(
    view: TextView,
    tag: Int,
    registration: Registration,
    content: ContentInfoCompat,
  ): ContentInfoCompat? {
    if (requested[tag] != registration) return content
    val pastedText = buildString {
      val clip = content.clip
      for (index in 0 until clip.itemCount) {
        val value = clip.getItemAt(index).coerceToText(view.context) ?: continue
        if (isNotEmpty()) append('\n')
        append(if (value is Spanned) value.toString() else value)
      }
    }
    if (!LargePastePolicy.shouldIntercept(pastedText.length, registration.minimumChars, content.source)) return content

    val start = minOf(view.selectionStart, view.selectionEnd).coerceAtLeast(0)
    val end = maxOf(view.selectionStart, view.selectionEnd).coerceAtLeast(start)
    val payload = Arguments.createMap().apply {
      putString("token", registration.token)
      putString("text", pastedText)
      putInt("start", start)
      putInt("end", end)
    }
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, payload)
    return null
  }

  private fun resolveTextView(uiManager: UIManager, tag: Int): TextView? = runCatching {
    uiManager.resolveView(tag) as? TextView
  }.getOrNull()

  companion object {
    private const val MODULE_NAME = "CodeWideLargePaste"
    private const val EVENT_NAME = "codewideLargePaste"
  }
}
