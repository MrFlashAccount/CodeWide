package dev.codewide.app.remote

import android.content.ClipboardManager
import android.content.Context
import android.text.InputFilter
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
 * Consumes opted-in large clipboard pastes before TextView commits them. The
 * receive-content listener handles Android paste actions and rich IME content;
 * the input filter handles keyboards that send clipboard text as 20K commitText
 * chunks. JS receives the complete ClipData payload in one event either way.
 */
class LargePasteModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private data class Registration(val token: String, val minimumChars: Int)
  private data class InstalledView(
    val registration: Registration,
    val inputFilter: InputFilter,
  )

  private val requested = mutableMapOf<Int, Registration>()
  private val installedViews = WeakHashMap<TextView, InstalledView>()
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
        .filter { it.value.registration.token == token }
        .map { it.key to it.value }
        .forEach { (view, installed) ->
          uninstallFromView(view, installed)
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
    val previous = installedViews[view]
    if (previous?.registration == registration && view.filters.any { it === previous.inputFilter }) return
    if (previous != null) uninstallFromView(view, previous)
    val inputFilter = ClipboardChunkInputFilter(view, tag, registration)
    installedViews[view] = InstalledView(registration, inputFilter)
    view.filters = arrayOf(inputFilter, *view.filters)
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
    val pastedText = clipText(view, content.clip)
    if (!LargePastePolicy.shouldIntercept(pastedText.length, registration.minimumChars, content.source)) return content

    val start = minOf(view.selectionStart, view.selectionEnd).coerceAtLeast(0)
    val end = maxOf(view.selectionStart, view.selectionEnd).coerceAtLeast(start)
    emitLargePaste(registration, pastedText, start, end)
    return null
  }

  private fun emitLargePaste(
    registration: Registration,
    pastedText: String,
    start: Int,
    end: Int,
  ) {
    val payload = Arguments.createMap().apply {
      putString("token", registration.token)
      putString("text", pastedText)
      putInt("start", start)
      putInt("end", end)
    }
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, payload)
  }

  private fun uninstallFromView(view: TextView, installed: InstalledView) {
    if (installedViews[view] !== installed) return
    ViewCompat.setOnReceiveContentListener(view, null, null)
    view.filters = view.filters.filterNot { it === installed.inputFilter }.toTypedArray()
    installedViews.remove(view)
  }

  private fun clipText(view: TextView, clip: android.content.ClipData): String = buildString {
    for (index in 0 until clip.itemCount) {
      val value = clip.getItemAt(index).coerceToText(view.context) ?: continue
      if (isNotEmpty()) append('\n')
      append(if (value is Spanned) value.toString() else value)
    }
  }

  private fun currentClipboardText(view: TextView): String? {
    val clipboard = view.context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      ?: return null
    val clip = clipboard.primaryClip ?: return null
    return clipText(view, clip)
  }

  private inner class ClipboardChunkInputFilter(
    private val view: TextView,
    private val tag: Int,
    private val registration: Registration,
  ) : InputFilter {
    private val chunkSuppression = LargePasteChunkSuppression()

    override fun filter(
      source: CharSequence,
      start: Int,
      end: Int,
      dest: Spanned,
      dstart: Int,
      dend: Int,
    ): CharSequence? {
      val chunkText = source.subSequence(start, end).toString()
      if (chunkText.isEmpty()) return null
      if (chunkSuppression.consume(chunkText)) return ""

      if (
        requested[tag] != registration ||
        !view.isFocused ||
        chunkText.length <= registration.minimumChars
      ) return null
      val clipboardText = currentClipboardText(view) ?: return null
      if (!LargePastePolicy.shouldInterceptClipboardChunk(chunkText, clipboardText, registration.minimumChars)) {
        return null
      }

      chunkSuppression.begin(clipboardText, chunkText.length)
      view.post {
        val installed = installedViews[view]
        if (requested[tag] == registration && installed?.inputFilter === this) {
          emitLargePaste(registration, clipboardText, dstart.coerceAtLeast(0), dend.coerceAtLeast(dstart))
        }
      }
      return ""
    }
  }

  private fun resolveTextView(uiManager: UIManager, tag: Int): TextView? = runCatching {
    uiManager.resolveView(tag) as? TextView
  }.getOrNull()

  companion object {
    private const val MODULE_NAME = "CodeWideLargePaste"
    private const val EVENT_NAME = "codewideLargePaste"
  }
}
