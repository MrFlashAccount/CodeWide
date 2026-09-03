package dev.codewide.app.remote

import android.util.Base64
import java.io.Closeable
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import kotlin.concurrent.thread
import okhttp3.OkHttpClient

/**
 * Presents a loopback HTTP origin to React Native and forwards its bytes to the
 * exact saved companion through profile-scoped pinned TLS. This keeps image,
 * ranged file, upload, telemetry and tunnel HTTP paths inside the same trust
 * boundary as the native WebSockets without replacing the platform fetch API.
 */
internal class NativeCompanionHttpProxy(
  private val credentials: NativeSessionCredentialsStore,
) : Closeable {
  private val proxies = ConcurrentHashMap<String, Proxy>()

  fun origin(connectionId: String): String {
    val saved = credentials.get(connectionId) ?: error("Saved native credentials are missing")
    require(saved.enabled) { "Connection is disabled" }
    PinnedTls.requireTransport(saved.endpoint, saved.innerTlsPinSha256)
    val fingerprint = "${saved.endpoint}\u0000${saved.innerTlsPinSha256}"
    val existing = proxies[connectionId]
    if (existing != null && existing.fingerprint == fingerprint) return existing.origin
    existing?.close()
    val replacement = Proxy(fingerprint, saved)
    proxies[connectionId] = replacement
    return replacement.origin
  }

  fun remove(connectionId: String) {
    proxies.remove(connectionId)?.close()
  }

  override fun close() {
    proxies.values.forEach(Proxy::close)
    proxies.clear()
  }

  private class Proxy(
    val fingerprint: String,
    private val saved: StoredNativeSession,
  ) : Closeable {
    private val endpointUri = URI(saved.endpoint)
    private val carrierClient = OkHttpClient()
    private val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    private val socketLifetime = NativeProxySocketLifetime()
    private val capability = newLoopbackCapability()
    private val clientSlots = Semaphore(MAX_ACTIVE_CLIENTS, true)
    private val acceptor = Executors.newSingleThreadExecutor { task ->
      Thread(task, "CodeWidePinnedHttpAccept").apply { isDaemon = true }
    }
    private val workers = Executors.newFixedThreadPool(MAX_ACTIVE_CLIENTS) { task ->
      Thread(task, "CodeWidePinnedHttp").apply { isDaemon = true }
    }
    @Volatile private var closed = false
    val origin = "http://127.0.0.1:${server.localPort}/$capability"

    init {
      acceptor.execute {
        while (!closed) {
          val client = try {
            server.accept()
          } catch (_: Throwable) {
            if (closed) break else continue
          }
          if (!clientSlots.tryAcquire()) {
            runCatching { client.close() }
            continue
          }
          try {
            workers.execute {
              try {
                bridge(client, endpointUri)
              } finally {
                clientSlots.release()
              }
            }
          } catch (_: Throwable) {
            clientSlots.release()
            runCatching { client.close() }
          }
        }
      }
    }

    override fun close() {
      closed = true
      runCatching { server.close() }
      socketLifetime.close()
      carrierClient.dispatcher.cancelAll()
      carrierClient.connectionPool.evictAll()
      carrierClient.dispatcher.executorService.shutdown()
      acceptor.shutdownNow()
      workers.shutdownNow()
    }

    private fun bridge(client: Socket, endpoint: URI) {
      if (!socketLifetime.register(client)) return
      try {
        client.use { downstream ->
          downstream.soTimeout = AUTHORIZATION_TIMEOUT_MS
          val downstreamInput = BufferedInputStream(downstream.getInputStream())
          val firstRequest = runCatching {
            val header = readHttpHeader(downstreamInput) ?: error("HTTP request is missing")
            HttpRequestHeader.parse(header).authorize(capability)
          }.getOrElse {
            runCatching { downstream.getOutputStream().write(FORBIDDEN_RESPONSE) }
            return
          }
          val connected = runCatching { connect() }.getOrElse { return }
          val upstream = connected.socket
          if (!socketLifetime.register(upstream)) {
            socketLifetime.remove(connected.carrier)
            return
          }
          try {
            upstream.use {
              downstream.soTimeout = HTTP_IDLE_TIMEOUT_MS
              upstream.soTimeout = HTTP_IDLE_TIMEOUT_MS
              val upstreamToDownstream = thread(name = "CodeWidePinnedHttpResponse", isDaemon = true) {
                try {
                  upstream.getInputStream().copyTo(downstream.getOutputStream())
                } catch (_: Throwable) {
                } finally {
                  runCatching { downstream.close() }
                  runCatching { upstream.close() }
                }
              }
              runCatching {
                forwardRequests(
                  downstreamInput,
                  upstream.getOutputStream(),
                  authority(endpoint),
                  firstRequest,
                ) {
                  downstream.soTimeout = 0
                  upstream.soTimeout = 0
                }
              }
              runCatching { upstream.shutdownOutput() }
              runCatching { upstreamToDownstream.join() }
            }
          } finally {
            socketLifetime.remove(upstream)
            socketLifetime.remove(connected.carrier)
          }
        }
      } finally {
        socketLifetime.remove(client)
      }
    }

    private fun connect(): ConnectedSocket {
      var carrier: Socket? = null
      return try {
        val socket = InnerTlsTransport.openSocket(carrierClient, saved, CONNECT_TIMEOUT_MS) { created ->
          carrier = created
          check(socketLifetime.register(created)) { "Pinned HTTP authority was revoked" }
        }
        ConnectedSocket(socket, requireNotNull(carrier))
      } catch (error: Throwable) {
        carrier?.let(socketLifetime::remove)
        throw error
      }
    }

    private data class ConnectedSocket(val socket: Socket, val carrier: Socket)

    private fun forwardRequests(
      input: BufferedInputStream,
      output: OutputStream,
      authority: String,
      firstRequest: HttpRequestHeader,
      onUpgrade: () -> Unit,
    ) {
      var request: HttpRequestHeader? = firstRequest
      while (!closed) {
        val current = requireNotNull(request)
        output.write(current.withAuthority(authority))
        when {
          current.upgrade -> {
            onUpgrade()
            output.flush()
            input.copyTo(output)
            return
          }
          current.chunked -> copyChunkedBody(input, output)
          current.contentLength > 0L -> copyExactly(input, output, current.contentLength)
        }
        output.flush()
        if (current.close) return
        val header = readHttpHeader(input) ?: return
        request = HttpRequestHeader.parse(header).authorize(capability)
      }
    }

    private fun copyChunkedBody(input: BufferedInputStream, output: OutputStream) {
      var totalBytes = 0L
      while (true) {
        val line = readHttpLine(input)
        output.write(line)
        val sizeText = line.toString(StandardCharsets.ISO_8859_1)
          .removeSuffix("\r\n")
          .substringBefore(';')
          .trim()
        val size = sizeText.toLongOrNull(16) ?: error("Invalid chunked request body")
        totalBytes = Math.addExact(totalBytes, size)
        check(totalBytes <= MAX_REQUEST_BODY_BYTES) { "HTTP request body is too large" }
        if (size == 0L) {
          while (true) {
            val trailer = readHttpLine(input)
            output.write(trailer)
            if (trailer.contentEquals(CRLF)) return
          }
        }
        copyExactly(input, output, size)
        val terminator = ByteArray(2)
        readExactly(input, terminator)
        check(terminator.contentEquals(CRLF)) { "Invalid chunk terminator" }
        output.write(terminator)
      }
    }

    private fun copyExactly(input: InputStream, output: OutputStream, byteCount: Long) {
      var remaining = byteCount
      val buffer = ByteArray(STREAM_BUFFER_BYTES)
      while (remaining > 0L) {
        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
        check(count >= 0) { "HTTP client disconnected before sending the request body" }
        output.write(buffer, 0, count)
        remaining -= count
      }
    }

    private fun readExactly(input: InputStream, destination: ByteArray) {
      var offset = 0
      while (offset < destination.size) {
        val count = input.read(destination, offset, destination.size - offset)
        check(count >= 0) { "HTTP client disconnected before completing the request" }
        offset += count
      }
    }

    private fun readHttpHeader(input: BufferedInputStream): ByteArray? {
      val output = ByteArrayOutputStream()
      var tail = 0
      while (output.size() < MAX_HEADER_BYTES) {
        val value = input.read()
        if (value < 0) {
          if (output.size() == 0) return null
          error("HTTP client disconnected before completing request headers")
        }
        output.write(value)
        tail = ((tail shl 8) or value) and 0xffffffff.toInt()
        if (tail == 0x0d0a0d0a) return output.toByteArray()
      }
      error("HTTP request headers are too large")
    }

    private fun readHttpLine(input: BufferedInputStream): ByteArray {
      val output = ByteArrayOutputStream()
      var previous = -1
      while (output.size() < MAX_HEADER_BYTES) {
        val value = input.read()
        check(value >= 0) { "HTTP client disconnected inside a chunked request" }
        output.write(value)
        if (previous == '\r'.code && value == '\n'.code) return output.toByteArray()
        previous = value
      }
      error("HTTP chunk metadata is too large")
    }

    private fun authority(endpoint: URI): String {
      val host = requireNotNull(endpoint.host)
      val renderedHost = if (host.contains(':')) "[$host]" else host
      val defaultPort = if (endpoint.scheme == "wss") 443 else 80
      return if (endpoint.port < 0 || endpoint.port == defaultPort) renderedHost else "$renderedHost:${endpoint.port}"
    }
  }

  companion object {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val AUTHORIZATION_TIMEOUT_MS = 10_000
    private const val HTTP_IDLE_TIMEOUT_MS = 60_000
    private const val MAX_ACTIVE_CLIENTS = 16
    private const val MAX_REQUEST_BODY_BYTES = 512L * 1024 * 1024
    private const val MAX_HEADER_BYTES = 64 * 1024
    private const val STREAM_BUFFER_BYTES = 16 * 1024
    private val CRLF = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte())
    private val FORBIDDEN_RESPONSE = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      .toByteArray(StandardCharsets.ISO_8859_1)

    private fun newLoopbackCapability(): String {
      val bytes = ByteArray(32)
      SecureRandom().nextBytes(bytes)
      return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
  }
}

internal class NativeProxySocketLifetime {
  private val lock = Any()
  private val sockets = mutableSetOf<Socket>()
  private var closed = false

  fun register(socket: Socket): Boolean = synchronized(lock) {
    if (closed) {
      runCatching { socket.close() }
      false
    } else {
      sockets += socket
      true
    }
  }

  fun remove(socket: Socket) = synchronized(lock) {
    sockets -= socket
  }

  fun close() {
    val retired = synchronized(lock) {
      if (closed) return
      closed = true
      sockets.toList().also { sockets.clear() }
    }
    retired.forEach { runCatching { it.close() } }
  }
}

internal data class HttpRequestHeader(
  private val requestLine: String,
  private val fields: List<Pair<String, String>>,
  val contentLength: Long,
  val chunked: Boolean,
  val close: Boolean,
  val upgrade: Boolean,
) {
  fun authorize(capability: String): HttpRequestHeader {
    require(capability.matches(CAPABILITY_PATTERN)) { "Loopback capability is invalid" }
    val parts = requestLine.split(' ', limit = 3)
    check(parts.size == 3 && (parts[2] == "HTTP/1.1" || parts[2] == "HTTP/1.0")) {
      "Invalid HTTP request line"
    }
    val prefix = "/$capability"
    val target = parts[1]
    check(target.startsWith("$prefix/")) { "Loopback request capability is invalid" }
    val upstreamTarget = target.removePrefix(prefix)
    return HttpRequestHeader(
      requestLine = "${parts[0]} $upstreamTarget ${parts[2]}",
      fields = fields,
      contentLength = contentLength,
      chunked = chunked,
      close = close,
      upgrade = upgrade,
    )
  }

  fun withAuthority(authority: String): ByteArray {
    val rewritten = ArrayList<Pair<String, String>>(fields.size + 1)
    var replacedHost = false
    for ((name, value) in fields) {
      if (name.equals("host", ignoreCase = true)) {
        if (!replacedHost) rewritten += name to authority
        replacedHost = true
      } else {
        rewritten += name to value
      }
    }
    if (!replacedHost) rewritten += "Host" to authority
    return buildString {
      append(requestLine).append("\r\n")
      for ((name, value) in rewritten) append(name).append(": ").append(value).append("\r\n")
      append("\r\n")
    }.toByteArray(StandardCharsets.ISO_8859_1)
  }

  companion object {
    private val CAPABILITY_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")

    fun parse(bytes: ByteArray): HttpRequestHeader {
      val text = bytes.toString(StandardCharsets.ISO_8859_1)
      check(text.endsWith("\r\n\r\n")) { "Incomplete HTTP request headers" }
      val lines = text.removeSuffix("\r\n\r\n").split("\r\n")
      val requestLine = lines.firstOrNull().orEmpty()
      check(requestLine.split(' ', limit = 3).size == 3) { "Invalid HTTP request line" }
      val fields = lines.drop(1).map { line ->
        val separator = line.indexOf(':')
        check(separator > 0) { "Invalid HTTP request header" }
        line.substring(0, separator) to line.substring(separator + 1).trim()
      }
      val contentLengths = fields
        .filter { (name) -> name.equals("content-length", ignoreCase = true) }
        .map { (_, value) -> value.trim().toLongOrNull() ?: error("Invalid Content-Length") }
        .distinct()
      check(contentLengths.size <= 1) { "Conflicting Content-Length headers" }
      val contentLength = contentLengths.singleOrNull() ?: 0L
      check(contentLength in 0..MAX_PROXY_REQUEST_BODY_BYTES) { "HTTP request body is too large" }
      val transferEncoding = fields
        .filter { (name) -> name.equals("transfer-encoding", ignoreCase = true) }
        .flatMap { (_, value) -> value.split(',') }
        .map(String::trim)
      check(transferEncoding.all { it.equals("chunked", ignoreCase = true) }) {
        "Unsupported Transfer-Encoding"
      }
      check(transferEncoding.isEmpty() || contentLengths.isEmpty()) {
        "Ambiguous HTTP request body framing"
      }
      val connection = fields
        .filter { (name) -> name.equals("connection", ignoreCase = true) }
        .flatMap { (_, value) -> value.split(',') }
        .map(String::trim)
      return HttpRequestHeader(
        requestLine = requestLine,
        fields = fields,
        contentLength = contentLength,
        chunked = transferEncoding.any { it.equals("chunked", ignoreCase = true) },
        close = connection.any { it.equals("close", ignoreCase = true) },
        upgrade = connection.any { it.equals("upgrade", ignoreCase = true) },
      )
    }

    private const val MAX_PROXY_REQUEST_BODY_BYTES = 512L * 1024 * 1024
  }
}
