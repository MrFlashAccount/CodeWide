package dev.codewide.app.rendering

import android.os.Handler
import android.os.Looper
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.UpdateAppearance
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import java.util.WeakHashMap

class ContentReviewSelectionModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private data class Registration(
    val token: String,
    val previous: ActionMode.Callback?,
  )

  private data class HighlightRange(val start: Int, val end: Int)
  private data class HighlightRequest(val token: String, val ranges: List<HighlightRange>)

  private class ReviewHighlightSpan : CharacterStyle(), UpdateAppearance {
    override fun updateDrawState(textPaint: TextPaint) {
      textPaint.bgColor = REVIEW_HIGHLIGHT_COLOR
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val requestedTokens = mutableMapOf<Int, String>()
  private val requestedHighlights = mutableMapOf<Int, HighlightRequest>()
  private val installedViews = WeakHashMap<TextView, Registration>()

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun install(reactTag: Double, token: String) {
    val tag = reactTag.toInt()
    if (tag <= 0 || token.isBlank()) return
    mainHandler.post {
      requestedTokens[tag] = token
      installWhenMounted(tag, token, 0)
    }
  }

  @ReactMethod
  fun uninstall(reactTag: Double, token: String) {
    val tag = reactTag.toInt()
    mainHandler.post {
      if (requestedTokens[tag] != token) return@post
      requestedTokens.remove(tag)
      requestedHighlights.remove(tag)
      val view = resolveTextView(tag) ?: return@post
      val registration = installedViews[view] ?: return@post
      if (registration.token != token) return@post
      view.customSelectionActionModeCallback = registration.previous
      clearHighlights(view)
      installedViews.remove(view)
    }
  }

  @ReactMethod
  fun setHighlights(reactTag: Double, token: String, highlights: ReadableArray) {
    val tag = reactTag.toInt()
    if (tag <= 0 || token.isBlank()) return
    val ranges = buildList {
      for (index in 0 until highlights.size()) {
        val item = highlights.getMap(index) ?: continue
        if (!item.hasKey("start") || !item.hasKey("end")) continue
        val start = item.getDouble("start").toInt()
        val end = item.getDouble("end").toInt()
        if (end > start) add(HighlightRange(start, end))
      }
    }
    mainHandler.post {
      requestedHighlights[tag] = HighlightRequest(token, ranges)
      applyHighlightsWhenMounted(tag, token, 0)
    }
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun installWhenMounted(tag: Int, token: String, attempt: Int) {
    if (requestedTokens[tag] != token) return
    val view = resolveTextView(tag)
    if (view === null) {
      if (attempt < MAX_RESOLVE_ATTEMPTS) {
        mainHandler.postDelayed({ installWhenMounted(tag, token, attempt + 1) }, RESOLVE_RETRY_MS)
      }
      return
    }
    val existing = installedViews[view]
    val previous = existing?.previous ?: view.customSelectionActionModeCallback
    installedViews[view] = Registration(token, previous)
    view.customSelectionActionModeCallback = reviewActionModeCallback(view, tag, token, previous)
    applyHighlights(view, requestedHighlights[tag]?.takeIf { it.token == token }?.ranges.orEmpty())
  }

  private fun applyHighlightsWhenMounted(tag: Int, token: String, attempt: Int) {
    if (requestedTokens[tag] != token || requestedHighlights[tag]?.token != token) return
    val view = resolveTextView(tag)
    if (view === null) {
      if (attempt < MAX_RESOLVE_ATTEMPTS) {
        mainHandler.postDelayed({ applyHighlightsWhenMounted(tag, token, attempt + 1) }, RESOLVE_RETRY_MS)
      }
      return
    }
    applyHighlights(view, requestedHighlights[tag]?.ranges.orEmpty())
  }

  private fun applyHighlights(view: TextView, ranges: List<HighlightRange>) {
    val text = view.text
    val spannable = if (text is Spannable) text else SpannableStringBuilder(text)
    spannable.getSpans(0, spannable.length, ReviewHighlightSpan::class.java).forEach(spannable::removeSpan)
    ranges.forEach { range ->
      val start = range.start.coerceIn(0, spannable.length)
      val end = range.end.coerceIn(start, spannable.length)
      if (end > start) spannable.setSpan(ReviewHighlightSpan(), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    if (spannable !== text) view.text = spannable
    view.invalidate()
  }

  private fun clearHighlights(view: TextView) {
    val spannable = view.text as? Spannable ?: return
    spannable.getSpans(0, spannable.length, ReviewHighlightSpan::class.java).forEach(spannable::removeSpan)
    view.invalidate()
  }

  private fun resolveTextView(tag: Int): TextView? = runCatching {
    UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag) as? TextView
  }.getOrNull()

  private fun reviewActionModeCallback(
    view: TextView,
    tag: Int,
    token: String,
    previous: ActionMode.Callback?,
  ): ActionMode.Callback = object : ActionMode.Callback {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      val accepted = previous?.onCreateActionMode(mode, menu) ?: true
      if (!accepted) return false
      ensureReviewItem(view, menu)
      return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      val changed = ensureReviewItem(view, menu)
      return (previous?.onPrepareActionMode(mode, menu) ?: false) || changed
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      if (item.itemId != REVIEW_MENU_ITEM_ID) {
        return previous?.onActionItemClicked(mode, item) ?: false
      }
      val start = minOf(view.selectionStart, view.selectionEnd).coerceAtLeast(0)
      val end = maxOf(view.selectionStart, view.selectionEnd).coerceAtMost(view.text.length)
      if (end <= start || requestedTokens[tag] != token) return false
      val selectedText = view.text.subSequence(start, end).toString()
      if (selectedText.isBlank()) return false
      val payload = Arguments.createMap().apply {
        putString("token", token)
        putString("text", selectedText)
        putInt("start", start)
        putInt("end", end)
      }
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, payload)
      mode.finish()
      return true
    }

    override fun onDestroyActionMode(mode: ActionMode) {
      previous?.onDestroyActionMode(mode)
    }
  }

  private fun ensureReviewItem(view: TextView, menu: Menu): Boolean {
    val hasSelection = view.selectionStart >= 0 && view.selectionEnd >= 0 && view.selectionStart != view.selectionEnd
    val existing = menu.findItem(REVIEW_MENU_ITEM_ID)
    if (!hasSelection) {
      if (existing === null) return false
      menu.removeItem(REVIEW_MENU_ITEM_ID)
      return true
    }
    if (existing !== null) return false
    menu.add(Menu.NONE, REVIEW_MENU_ITEM_ID, Menu.NONE, "Review")
      .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
    return true
  }

  companion object {
    private const val MODULE_NAME = "CodeWideContentReview"
    private const val EVENT_NAME = "codewideContentReviewSelection"
    private const val REVIEW_MENU_ITEM_ID = 0x434F4458
    private const val REVIEW_HIGHLIGHT_COLOR = 0x66B794F6
    private const val MAX_RESOLVE_ATTEMPTS = 4
    private const val RESOLVE_RETRY_MS = 16L
  }
}
