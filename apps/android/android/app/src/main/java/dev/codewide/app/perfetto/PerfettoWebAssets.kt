package dev.codewide.app.perfetto

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

/** This WebView can read the packaged UI and exactly one private staged file. */
internal class PerfettoWebAssets(private val assets: AssetManager, private val trace: File) {
  companion object {
    const val ORIGIN = "https://perfetto.codewide.invalid"
    // A versioned/embedded page below root skips Perfetto’s website service-worker install.
    const val ENTRY = "$ORIGIN/viewer/"
    private const val POLICY =
      "default-src 'self'; connect-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; " +
        "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'"
  }

  fun serve(uri: Uri, method: String): WebResourceResponse {
    if (
      uri.scheme != "https" ||
        uri.encodedAuthority != "perfetto.codewide.invalid" ||
        method != "GET"
    )
      return unavailable()
    val path = uri.path ?: return unavailable()
    return try {
      when {
        path == "/viewer/" -> response("text/html", assets.open("perfetto/index.html"))
        path == "/attachment/trace.perfetto-trace" ->
          response("application/octet-stream", trace.inputStream(), trace.length())
        path.startsWith("/ui/") &&
          path.split('/').drop(1).all {
            it.isNotEmpty() && it != "." && it != ".." && '\\' !in it
          } -> {
          val type =
            when (path.substringAfterLast('.')) {
              "js" -> "application/javascript"
              "css" -> "text/css"
              "wasm" -> "application/wasm"
              "json" -> "application/json"
              "woff2" -> "font/woff2"
              "png" -> "image/png"
              "html" -> "text/html"
              else -> "text/plain"
            }
          response(type, assets.open("perfetto$path"))
        }
        else -> unavailable()
      }
    } catch (_: IOException) {
      unavailable()
    }
  }

  private fun response(type: String, data: InputStream, length: Long? = null): WebResourceResponse {
    val headers =
      mutableMapOf(
        "Cache-Control" to "no-store",
        "Cross-Origin-Opener-Policy" to "same-origin",
        "Cross-Origin-Embedder-Policy" to "require-corp",
        "Content-Security-Policy" to POLICY,
      )
    if (length != null) headers["Content-Length"] = length.toString()
    return WebResourceResponse(type, null, 200, "OK", headers, data)
  }

  private fun unavailable() =
    WebResourceResponse(
      "text/plain",
      "utf-8",
      404,
      "Not Found",
      mapOf("Cache-Control" to "no-store"),
      ByteArrayInputStream(ByteArray(0)),
    )
}
