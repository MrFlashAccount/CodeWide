package dev.codewide.app.perfetto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import java.io.File
import java.io.IOException

/**
 * Hosts the official, offline Perfetto UI. The staged trace stays owned by its attachment query.
 */
internal class PerfettoInspectorView(context: Context) : FrameLayout(context) {
  private var source: String? = null
  private var browser: WebView? = null

  fun setSource(uri: String?) {
    if (source == uri) return
    source = uri
    clearBrowser()
    if (isAttachedToWindow) open()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (browser == null) open()
  }

  private fun clearBrowser() {
    removeAllViews()
    browser?.destroy()
    browser = null
  }

  // WHY: Perfetto runs its bundled JavaScript/WASM only inside this network-blocked WebView.
  @SuppressLint("SetJavaScriptEnabled")
  private fun open() {
    val uri = Uri.parse(source ?: return)
    val file =
      try {
        uri.path?.let { File(it).canonicalFile }
      } catch (_: IOException) {
        null
      }
    if (
      uri.scheme != "file" ||
        file == null ||
        file.parentFile != File(context.cacheDir, "codewide-trace-previews").canonicalFile ||
        !file.isFile
    ) {
      failed()
      return
    }
    val content = PerfettoWebAssets(context.assets, file)
    val view = WebView(context)
    browser = view
    view.setBackgroundColor(Color.rgb(15, 15, 15))
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      blockNetworkLoads = true
      cacheMode = WebSettings.LOAD_NO_CACHE
      setSupportZoom(false)
    }
    view.webViewClient =
      object : WebViewClient() {
        override fun shouldInterceptRequest(
          view: WebView,
          request: WebResourceRequest,
        ): WebResourceResponse = content.serve(request.url, request.method)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          request.url.buildUpon().fragment(null).build().toString() !=
            PerfettoWebAssets.ENTRY

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
          if (view === browser) failed()
          return true
        }
      }
    addView(view, LayoutParams(-1, -1))
    view.loadUrl(PerfettoWebAssets.ENTRY)
  }

  private fun failed() {
    clearBrowser()
    val retry = Button(context)
    retry.text = "Could not open trace · Retry"
    retry.setOnClickListener {
      removeAllViews()
      open()
    }
    addView(retry, LayoutParams(-2, -2, Gravity.CENTER))
  }
}
