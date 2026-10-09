package dev.codewide.app.remote

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.UIManagerHelper
import java.io.ByteArrayOutputStream

/** Reads the engine's loaded icon without replacing its ChromeClient or requesting another URL. */
internal class BrowserFaviconBridge(private val context: ReactApplicationContext) {
  private val handler = Handler(Looper.getMainLooper())

  fun read(tagValue: Double, expectedUrl: String, promise: Promise) {
    if (!tagValue.isFinite() || tagValue <= 0 || tagValue > Int.MAX_VALUE || tagValue % 1.0 != 0.0) {
      promise.resolve(null)
      return
    }
    handler.post {
      val page = try {
        val root = UIManagerHelper.getUIManagerForReactTag(context, tagValue.toInt())?.resolveView(tagValue.toInt())
        findWebView(root)
      } catch (_: RuntimeException) {
        null // A closed/replaced Fabric view is a normal stale result, not a browser failure.
      }
      if (page == null) promise.resolve(null)
      else readIcon(page, expectedUrl, promise, 0)
    }
  }

  private fun readIcon(page: WebView, expectedUrl: String, promise: Promise, attempt: Int) {
    try {
      readCurrentIcon(page, expectedUrl, promise, attempt)
    } catch (_: RuntimeException) {
      promise.resolve(null) // A disposed bitmap/view has no transferable icon.
    }
  }

  private fun readCurrentIcon(page: WebView, expectedUrl: String, promise: Promise, attempt: Int) {
    if (!context.hasActiveReactInstance() || !page.isAttachedToWindow || page.url != expectedUrl) {
      promise.resolve(null)
      return
    }
    val icon = page.favicon
    if (icon != null && !icon.isRecycled) {
      promise.resolve(browserFaviconData(icon))
    } else if (attempt < MAX_RETRIES) {
      // WebView can receive its favicon after onPageFinished. Retry only this retained page, briefly.
      handler.postDelayed({ readIcon(page, expectedUrl, promise, attempt + 1) }, RETRY_MS)
    } else {
      promise.resolve(null)
    }
  }

  private fun findWebView(view: View?): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  private companion object {
    const val MAX_RETRIES = 12
    const val RETRY_MS = 250L
  }
}

private const val BROWSER_FAVICON_SIZE = 64
private const val BROWSER_FAVICON_MAX_BYTES = 16_384

internal fun browserFaviconData(icon: Bitmap): String? {
  val maximum = maxOf(icon.width, icon.height)
  val scaled = if (maximum > BROWSER_FAVICON_SIZE) Bitmap.createScaledBitmap(
    icon,
    maxOf(1, icon.width * BROWSER_FAVICON_SIZE / maximum),
    maxOf(1, icon.height * BROWSER_FAVICON_SIZE / maximum),
    true,
  ) else icon
  return try {
    val bytes = ByteArrayOutputStream()
    if (!scaled.compress(Bitmap.CompressFormat.PNG, 100, bytes) || bytes.size() > BROWSER_FAVICON_MAX_BYTES) null
    else "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
  } finally {
    if (scaled !== icon) scaled.recycle() // The original bitmap remains WebView-owned.
  }
}
