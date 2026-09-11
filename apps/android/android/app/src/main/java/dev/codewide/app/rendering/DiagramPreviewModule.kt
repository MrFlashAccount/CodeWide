package dev.codewide.app.rendering

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.min
import kotlin.math.roundToInt

/** One temporary layout compiler, never one browser per mounted diagram. */
class DiagramPreviewModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class Job(val id: String, val source: String, val promise: Promise)
  private val handler = Handler(Looper.getMainLooper())
  private val encoder = Executors.newSingleThreadExecutor()
  private val pending = ArrayDeque<Job>()
  private var active: Job? = null
  private var browser: WebView? = null
  private var ready = false
  private var closed = false
  private val deadline = Runnable { fail("Diagram preview timed out") }

  override fun getName() = "CodeWideDiagramPreview"

  @ReactMethod
  fun render(id: String, source: String, promise: Promise) {
    handler.post {
      if (closed) promise.reject("DIAGRAM_CLOSED", "Diagram renderer is closed")
      else {
        val cached = cachedPreview(id, source)
        if (cached != null) {
          promise.resolve(cached)
          return@post
        }
        pending.addLast(Job(id, source, promise))
        advance()
      }
    }
  }

  @ReactMethod
  fun cancel(id: String) {
    handler.post {
      val iterator = pending.iterator()
      while (iterator.hasNext()) {
        val job = iterator.next()
        if (job.id == id) {
          iterator.remove()
          job.promise.reject("DIAGRAM_CANCELLED", "Diagram preview cancelled")
        }
      }
      if (active?.id == id) fail("Diagram preview cancelled")
    }
  }

  override fun invalidate() {
    handler.post {
      closed = true
      active?.promise?.reject("DIAGRAM_CLOSED", "Diagram renderer is closed")
      active = null
      pending.forEach { it.promise.reject("DIAGRAM_CLOSED", "Diagram renderer is closed") }
      pending.clear()
      destroyBrowser()
      encoder.shutdownNow()
    }
    super.invalidate()
  }

  private fun advance() {
    if (closed || active != null) return
    active = pending.removeFirstOrNull()
    if (active == null) {
      destroyBrowser()
      return
    }
    handler.postDelayed(deadline, 30_000)
    try {
      if (browser == null) createBrowser() else if (ready) renderActive()
    } catch (_: Exception) {
      fail("Could not initialize diagram renderer")
    }
  }

  // WHY: JavaScript runs only bundled renderer assets. All non-asset requests
  // and navigations are blocked; diagram text is passed as a quoted JSON value.
  @SuppressLint("SetJavaScriptEnabled")
  private fun createBrowser() {
    val view = WebView(reactApplicationContext)
    browser = view
    view.settings.javaScriptEnabled = true
    view.settings.allowFileAccess = true
    view.settings.allowContentAccess = false
    view.settings.blockNetworkLoads = true
    view.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val allowed = request.url.toString() in ASSETS
        return if (allowed) null else WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (view === browser && request.isForMainFrame) fail("Could not load diagram renderer")
      }
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        if (view === browser) fail("Diagram renderer stopped")
        return true
      }
    }
    view.addJavascriptInterface(object {
      @JavascriptInterface
      fun postMessage(message: String) { handler.post { receive(view, message) } }
    }, "CodeWideDiagramPreview")
    // Detached preview compilation must not depend on an animation frame or
    // on the measured size/lifetime of a particular React card.
    view.layout(0, 0, 1024, 1024)
    view.loadUrl("file:///android_asset/mermaid-renderer.html")
  }

  private fun renderActive() {
    val job = active ?: return
    val view = browser ?: return
    view.measure(
      View.MeasureSpec.makeMeasureSpec(PREVIEW_MAX_WIDTH, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(PREVIEW_MAX_HEIGHT, View.MeasureSpec.EXACTLY),
    )
    view.layout(0, 0, PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT)
    browser?.evaluateJavascript(
      "window.renderMermaid(${JSONObject.quote(job.source)},${JSONObject.quote(job.id)},'preview');true;",
      null,
    )
  }

  private fun receive(sender: WebView, message: String) {
    if (sender !== browser) return
    val value = try { JSONObject(message) } catch (_: Exception) { fail("Invalid diagram preview response"); return }
    if (value.optString("type") == "ready") {
      ready = true
      renderActive()
      return
    }
    val job = active ?: return
    if (value.optString("requestId") != job.id) return
    when (value.optString("type")) {
      "preview-ready" -> capturePreview(sender, job, value)
      // Mermaid syntax and layout errors belong to this source, not to the
      // renderer process. Keep the compiler alive for the remaining queue and
      // let React display the exact error beside the affected diagram.
      "error" -> {
        handler.removeCallbacks(deadline)
        active = null
        job.promise.resolve(message)
        advance()
      }
      else -> fail("Invalid diagram preview response")
    }
  }

  private fun capturePreview(view: WebView, job: Job, value: JSONObject) {
    val sourceWidth = value.optDouble("width")
    val sourceHeight = value.optDouble("height")
    if (!sourceWidth.isFinite() || sourceWidth <= 0.0 || !sourceHeight.isFinite() || sourceHeight <= 0.0) {
      fail("Invalid diagram preview dimensions")
      return
    }
    val scale = min(PREVIEW_MAX_WIDTH / sourceWidth, PREVIEW_MAX_HEIGHT / sourceHeight)
    val width = (sourceWidth * scale).roundToInt().coerceAtLeast(1)
    val height = (sourceHeight * scale).roundToInt().coerceAtLeast(1)
    val output = previewFile(job.source)
    if (output.isFile && output.length() > 0) {
      completePreview(view, job, output, width, height)
      return
    }
    view.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    view.layout(0, 0, width, height)
    handler.postDelayed({
      if (view !== browser || active?.id != job.id) return@postDelayed
      val bitmap = try {
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
      } catch (_: Exception) {
        fail("Could not capture diagram preview")
        return@postDelayed
      }
      encoder.execute {
        val temporary = File(output.parentFile, "${output.name}.${job.id}.tmp")
        val encoded = try {
          output.parentFile?.mkdirs()
          FileOutputStream(temporary).use { stream -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream) }
            && (temporary.renameTo(output) || temporary.copyTo(output, overwrite = true).let { temporary.delete(); true })
        } catch (_: Exception) {
          false
        } finally {
          bitmap.recycle()
        }
        handler.post {
          if (view !== browser || active?.id != job.id) {
            temporary.delete()
          } else if (encoded) {
            completePreview(view, job, output, width, height)
          } else {
            temporary.delete()
            fail("Could not encode diagram preview")
          }
        }
      }
    }, PREVIEW_CAPTURE_DELAY_MS)
  }

  private fun completePreview(view: WebView, job: Job, output: File, width: Int, height: Int) {
    if (view !== browser || active?.id != job.id) return
    output.setLastModified(System.currentTimeMillis())
    handler.removeCallbacks(deadline)
    active = null
    job.promise.resolve(previewResponse(job.id, output, width, height))
    advance()
  }

  private fun previewFile(source: String): File {
    val digest = MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8))
      .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
    return File(File(reactApplicationContext.cacheDir, PREVIEW_CACHE_DIRECTORY), "$digest.png")
  }

  private fun cachedPreview(id: String, source: String): String? {
    val output = previewFile(source)
    if (!output.isFile || output.length() <= 0) return null
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(output.absolutePath, options)
    if (options.outWidth <= 0 || options.outHeight <= 0) {
      output.delete()
      return null
    }
    output.setLastModified(System.currentTimeMillis())
    return previewResponse(id, output, options.outWidth, options.outHeight)
  }

  private fun previewResponse(id: String, output: File, width: Int, height: Int): String = JSONObject()
    .put("type", "preview")
    .put("requestId", id)
    .put("uri", Uri.fromFile(output).toString())
    .put("width", width)
    .put("height", height)
    .toString()

  private fun fail(message: String) {
    active?.promise?.reject("DIAGRAM_PREVIEW_FAILED", message)
    active = null
    destroyBrowser()
    advance()
  }

  private fun destroyBrowser() {
    handler.removeCallbacks(deadline)
    browser?.removeJavascriptInterface("CodeWideDiagramPreview")
    browser?.stopLoading()
    browser?.destroy()
    browser = null
    ready = false
  }

  private companion object {
    const val PREVIEW_MAX_WIDTH = 1024
    const val PREVIEW_MAX_HEIGHT = 1024
    const val PREVIEW_CAPTURE_DELAY_MS = 32L
    // Rendering geometry is part of the cache format. A version bump prevents
    // corrected previews from reusing PNGs captured by the old inline layout.
    const val PREVIEW_CACHE_DIRECTORY = "diagram-previews-v2"
    val ASSETS = setOf("mermaid-renderer.html", "mermaid.min.js", "panzoom.min.js", "diagram-preview.js")
      .map { "file:///android_asset/$it" }.toSet()
  }
}
