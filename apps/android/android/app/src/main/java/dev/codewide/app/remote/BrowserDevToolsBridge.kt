package dev.codewide.app.remote

import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.os.Process
import android.os.Looper
import android.webkit.TracingConfig
import android.webkit.TracingController
import android.webkit.WebView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.codewide.app.BuildConfig
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.FilterOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/**
 * Exposes this process' WebView DevTools socket only to an authenticated IPv4
 * loopback endpoint. Chromium DevTools can then use the normal HTTP discovery
 * and WebSocket CDP protocol without making the abstract Unix socket public.
 */
class BrowserDevToolsBridge(private val context: ReactApplicationContext) : Closeable {
  private val workerPool: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "CodeWideBrowserDevToolsProxy").apply { isDaemon = true }
  }
  private val traceExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "CodeWideBrowserTrace").apply { isDaemon = true }
  }
  private val openConnections = Collections.synchronizedSet(mutableSetOf<Closeable>())
  private var serverSocket: ServerSocket? = null
  private var accessToken: String? = null
  private var traceFile: File? = null
  private var traceRunning = false
  private var debuggingEnabledByBridge = false
  @Volatile private var accepting = false

  @Synchronized
  fun start(): Map<String, Any> {
    val existing = serverSocket
    val existingToken = accessToken
    if (existing != null && existingToken != null && accepting) {
      return bridgeResult(existing.localPort, existingToken)
    }

    setWebContentsDebuggingEnabledOnUiThread(true)
    debuggingEnabledByBridge = true
    val server = try {
      ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(InetAddress.getByName(LOOPBACK_HOST), 0), BACKLOG)
      }
    } catch (error: Throwable) {
      debuggingEnabledByBridge = false
      if (!BuildConfig.DEBUG) setWebContentsDebuggingEnabledOnUiThread(false)
      throw error
    }
    val token = randomToken()
    serverSocket = server
    accessToken = token
    accepting = true
    thread(name = "CodeWideBrowserDevToolsAccept", isDaemon = true) {
      acceptConnections(server, token)
    }
    return bridgeResult(server.localPort, token)
  }

  @Synchronized
  fun stop() {
    if (traceRunning) {
      val unfinishedTrace = traceFile
      traceRunning = false
      traceFile = null
      if (unfinishedTrace != null) {
        try {
          val output = FileOutputStream(unfinishedTrace)
          if (!TracingController.getInstance().stop(output, traceExecutor)) {
            output.close()
            unfinishedTrace.delete()
          }
        } catch (_: Throwable) {
          unfinishedTrace.delete()
        }
      }
    }
    accepting = false
    serverSocket?.closeQuietly()
    serverSocket = null
    accessToken = null
    val connections = synchronized(openConnections) { openConnections.toList() }
    connections.forEach(Closeable::closeQuietly)
    if (debuggingEnabledByBridge) {
      debuggingEnabledByBridge = false
      if (!BuildConfig.DEBUG) setWebContentsDebuggingEnabledOnUiThread(false)
    }
  }

  @Synchronized
  fun startTracing(promise: Promise) {
    if (traceRunning) {
      promise.reject("BROWSER_TRACE_ALREADY_RUNNING", "A browser performance trace is already running")
      return
    }
    try {
      val file = File(context.cacheDir, "browser-performance-${System.currentTimeMillis()}.json")
      val config = TracingConfig.Builder()
        .addCategories(TracingConfig.CATEGORIES_ALL)
        .setTracingMode(TracingConfig.RECORD_CONTINUOUSLY)
        .build()
      val controller = TracingController.getInstance()
      check(!controller.isTracing) { "Another WebView performance trace is already running" }
      controller.start(config)
      traceFile = file
      traceRunning = true
      promise.resolve(null)
    } catch (error: Throwable) {
      traceFile = null
      traceRunning = false
      promise.reject("BROWSER_TRACE_START_FAILED", error.message, error)
    }
  }

  @Synchronized
  fun stopTracing(promise: Promise) {
    val file = traceFile
    if (!traceRunning || file == null) {
      promise.reject("BROWSER_TRACE_NOT_RUNNING", "No browser performance trace is running")
      return
    }
    traceRunning = false
    traceFile = null
    val completed = AtomicBoolean(false)
    try {
      val stream = object : FilterOutputStream(FileOutputStream(file)) {
        override fun close() {
          try {
            super.close()
            if (completed.compareAndSet(false, true)) {
              promise.resolve(Arguments.createMap().apply {
                putString("path", file.absolutePath)
                putDouble("size", file.length().toDouble())
              })
            }
          } catch (error: Throwable) {
            if (completed.compareAndSet(false, true)) {
              promise.reject("BROWSER_TRACE_WRITE_FAILED", error.message, error)
            }
          }
        }
      }
      if (!TracingController.getInstance().stop(stream, traceExecutor)) {
        completed.set(true)
        stream.close()
        file.delete()
        promise.reject("BROWSER_TRACE_STOP_FAILED", "WebView rejected the performance trace stop request")
      }
    } catch (error: Throwable) {
      file.delete()
      if (completed.compareAndSet(false, true)) {
        promise.reject("BROWSER_TRACE_STOP_FAILED", error.message, error)
      }
    }
  }

  override fun close() {
    stop()
    workerPool.shutdownNow()
    traceExecutor.shutdownNow()
  }

  private fun acceptConnections(server: ServerSocket, token: String) {
    try {
      while (accepting && serverSocket === server) {
        val client = server.accept()
        if (client.inetAddress?.isLoopbackAddress != true) {
          client.closeQuietly()
          continue
        }
        workerPool.execute { proxy(client, token) }
      }
    } catch (_: Throwable) {
      // Closing the server socket is the normal stop path.
    }
  }

  private fun proxy(client: Socket, token: String) {
    var backend: LocalSocket? = null
    try {
      openConnections += client
      client.soTimeout = HEADER_TIMEOUT_MS
      val clientInput = BufferedInputStream(client.getInputStream())
      val header = readHttpHeader(clientInput)
      when (val asset = BrowserDevToolsAssetRequest.resolve(header, token)) {
        BrowserDevToolsAssetResolution.NotAsset -> Unit
        BrowserDevToolsAssetResolution.Forbidden -> {
          client.getOutputStream().write(FORBIDDEN_RESPONSE)
          return
        }
        is BrowserDevToolsAssetResolution.Asset -> {
          serveBundledAsset(client, asset)
          return
        }
      }
      val authenticatedHeader = BrowserDevToolsRequestAuth.authenticateAndStrip(header, token)
      if (authenticatedHeader == null) {
        client.getOutputStream().write(FORBIDDEN_RESPONSE)
        return
      }

      val upstream = LocalSocket().apply {
        connect(LocalSocketAddress(devToolsSocketName(), LocalSocketAddress.Namespace.ABSTRACT))
      }
      backend = upstream
      openConnections += upstream
      upstream.outputStream.write(authenticatedHeader)
      upstream.outputStream.flush()
      client.soTimeout = 0

      val finished = CountDownLatch(1)
      workerPool.execute {
        try {
          clientInput.copyTo(upstream.outputStream)
        } catch (_: Throwable) {
        } finally {
          finished.countDown()
        }
      }
      workerPool.execute {
        try {
          upstream.inputStream.copyTo(client.getOutputStream())
        } catch (_: Throwable) {
        } finally {
          finished.countDown()
        }
      }
      finished.await()
    } catch (_: Throwable) {
      try {
        client.getOutputStream().write(BAD_GATEWAY_RESPONSE)
      } catch (_: Throwable) {
      }
    } finally {
      client.closeQuietly()
      backend?.closeQuietly()
      openConnections -= client
      if (backend != null) openConnections -= backend
    }
  }

  private fun serveBundledAsset(client: Socket, asset: BrowserDevToolsAssetResolution.Asset) {
    val input = try {
      context.assets.open(asset.path)
    } catch (_: Throwable) {
      client.getOutputStream().write(NOT_FOUND_RESPONSE)
      return
    }
    input.use { assetInput ->
      client.soTimeout = 0
      val output = client.getOutputStream()
      val responseHeader = buildString {
        append("HTTP/1.1 200 OK\r\n")
        append("Content-Type: ")
        append(assetContentType(asset.path))
        append("\r\nCache-Control: no-store\r\n")
        append("X-Content-Type-Options: nosniff\r\n")
        append("Connection: close\r\n\r\n")
      }.toByteArray(StandardCharsets.ISO_8859_1)
      output.write(responseHeader)
      if (!asset.headOnly) assetInput.copyTo(output)
      output.flush()
    }
  }

  private fun assetContentType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
    "html" -> "text/html; charset=utf-8"
    "js" -> "text/javascript; charset=utf-8"
    "css" -> "text/css; charset=utf-8"
    "json", "map" -> "application/json; charset=utf-8"
    "svg" -> "image/svg+xml"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "avif" -> "image/avif"
    "ico" -> "image/x-icon"
    "wasm" -> "application/wasm"
    "woff" -> "font/woff"
    "woff2" -> "font/woff2"
    "md" -> "text/markdown; charset=utf-8"
    else -> "application/octet-stream"
  }

  private fun setWebContentsDebuggingEnabledOnUiThread(enabled: Boolean) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      WebView.setWebContentsDebuggingEnabled(enabled)
      return
    }
    val completed = CountDownLatch(1)
    val failure = AtomicReference<Throwable?>(null)
    context.runOnUiQueueThread {
      try {
        WebView.setWebContentsDebuggingEnabled(enabled)
      } catch (error: Throwable) {
        failure.set(error)
      } finally {
        completed.countDown()
      }
    }
    check(completed.await(UI_THREAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      "Timed out while toggling WebView debugging on the UI thread"
    }
    failure.get()?.let { error -> throw error }
  }

  private fun devToolsSocketName(): String {
    val expectedPrefix = "webview_devtools_remote_${Process.myPid()}"
    return try {
      File("/proc/net/unix").useLines { lines ->
        lines.mapNotNull { line -> line.substringAfterLast('@', "").takeIf(String::isNotBlank) }
          .firstOrNull { name -> name == expectedPrefix || name.startsWith("${expectedPrefix}_") }
      } ?: expectedPrefix
    } catch (_: Throwable) {
      expectedPrefix
    }
  }

  private fun bridgeResult(port: Int, token: String): Map<String, Any> = mapOf(
    "host" to LOOPBACK_HOST,
    "port" to port,
    "token" to token,
    "tracingSupported" to true,
  )

  private fun randomToken(): String = ByteArray(TOKEN_BYTES).also(SecureRandom()::nextBytes)
    .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

  companion object {
    private const val LOOPBACK_HOST = "127.0.0.1"
    private const val BACKLOG = 32
    private const val HEADER_TIMEOUT_MS = 5_000
    private const val UI_THREAD_TIMEOUT_MS = 5_000L
    private const val TOKEN_BYTES = 32
    private const val MAX_HEADER_BYTES = 64 * 1024
    private val FORBIDDEN_RESPONSE = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      .toByteArray(StandardCharsets.ISO_8859_1)
    private val BAD_GATEWAY_RESPONSE = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      .toByteArray(StandardCharsets.ISO_8859_1)
    private val NOT_FOUND_RESPONSE = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      .toByteArray(StandardCharsets.ISO_8859_1)

    private fun readHttpHeader(input: BufferedInputStream): ByteArray {
      val output = ByteArrayOutputStream()
      var tail = 0
      while (output.size() < MAX_HEADER_BYTES) {
        val value = input.read()
        check(value >= 0) { "DevTools client disconnected before sending headers" }
        output.write(value)
        tail = ((tail shl 8) or value) and 0xffffffff.toInt()
        if (tail == 0x0d0a0d0a) return output.toByteArray()
      }
      throw IllegalArgumentException("DevTools request headers are too large")
    }
  }
}

internal sealed class BrowserDevToolsAssetResolution {
  object NotAsset : BrowserDevToolsAssetResolution()
  object Forbidden : BrowserDevToolsAssetResolution()
  data class Asset(val path: String, val headOnly: Boolean) : BrowserDevToolsAssetResolution()
}

internal object BrowserDevToolsAssetRequest {
  fun resolve(headerBytes: ByteArray, token: String): BrowserDevToolsAssetResolution {
    val header = headerBytes.toString(StandardCharsets.ISO_8859_1)
    val firstLine = header.substringBefore("\r\n", "")
    val parts = firstLine.split(' ', limit = 3)
    if (parts.size != 3) return BrowserDevToolsAssetResolution.NotAsset
    val rawPath = parts[1].substringBefore('?')
    if (!rawPath.startsWith(ASSET_ROUTE_ROOT)) return BrowserDevToolsAssetResolution.NotAsset

    val authenticatedPrefix = "$ASSET_ROUTE_ROOT$token/"
    if (!rawPath.startsWith(authenticatedPrefix)) return BrowserDevToolsAssetResolution.Forbidden
    if (parts[0] != "GET" && parts[0] != "HEAD") return BrowserDevToolsAssetResolution.Forbidden
    val relativePath = rawPath.removePrefix(authenticatedPrefix)
    val segments = relativePath.split('/')
    if (segments.isEmpty() || segments.any { segment ->
        segment.isEmpty() || segment == "." || segment == ".." || !SAFE_ASSET_SEGMENT.matches(segment)
      }) {
      return BrowserDevToolsAssetResolution.Forbidden
    }
    return BrowserDevToolsAssetResolution.Asset(
      path = "browser-devtools/${segments.joinToString("/")}",
      headOnly = parts[0] == "HEAD",
    )
  }

  private const val ASSET_ROUTE_ROOT = "/browser-devtools/"
  private val SAFE_ASSET_SEGMENT = Regex("[A-Za-z0-9_.-]+")
}

internal object BrowserDevToolsRequestAuth {
  fun authenticateAndStrip(headerBytes: ByteArray, token: String): ByteArray? {
    val header = headerBytes.toString(StandardCharsets.ISO_8859_1)
    val lineEnd = header.indexOf("\r\n")
    if (lineEnd < 0) return null
    val firstLine = header.substring(0, lineEnd)
    val parts = firstLine.split(' ', limit = 3)
    if (parts.size != 3) return null
    val sanitizedTarget = authenticatedTarget(parts[1], token) ?: return null
    val remainingHeaders = header.substring(lineEnd + 2)
    val sanitizedHeaders = ORIGIN_HEADER.replace(remainingHeaders) { match ->
      "${match.groupValues[1]}Origin: devtools://devtools"
    }
    return buildString(header.length) {
      append(parts[0])
      append(' ')
      append(sanitizedTarget)
      append(' ')
      append(parts[2])
      append("\r\n")
      append(sanitizedHeaders)
    }.toByteArray(StandardCharsets.ISO_8859_1)
  }

  private fun authenticatedTarget(target: String, token: String): String? {
    val question = target.indexOf('?')
    if (question < 0) return null
    val path = target.substring(0, question)
    val parameters = target.substring(question + 1).split('&')
    var authenticated = false
    val retained = parameters.filter { parameter ->
      val key = parameter.substringBefore('=')
      if (key != "codewide_token") return@filter true
      authenticated = parameter.substringAfter('=', "") == token
      false
    }
    if (!authenticated) return null
    return if (retained.isEmpty()) path else "$path?${retained.joinToString("&")}"
  }

  private val ORIGIN_HEADER = Regex("(?i)(^|\\r\\n)Origin:[^\\r\\n]*")
}

private fun Closeable.closeQuietly() {
  try {
    close()
  } catch (_: Throwable) {
  }
}
