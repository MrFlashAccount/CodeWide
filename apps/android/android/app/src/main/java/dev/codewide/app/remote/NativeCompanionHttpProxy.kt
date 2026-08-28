package dev.codewide.app.remote

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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
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
    private val activeSockets = ConcurrentHashMap.newKeySet<Socket>()
    private val workers = Executors.newCachedThreadPool { task ->
      Thread(task, "CodeWidePinnedHttp").apply { isDaemon = true }
    }
    @Volatile private var closed = false
    val origin = "http://127.0.0.1:${server.localPort}"

    init {
      workers.execute {
        while (!closed) {
          val client = try {
            server.accept()
          } catch (_: Throwable) {
            if (closed) break else continue
          }
          workers.execute { bridge(client, endpointUri) }
        }
      }
    }

    override fun close() {
      closed = true
      runCatching { server.close() }
      activeSockets.forEach { runCatching { it.close() } }
      activeSockets.clear()
      carrierClient.dispatcher.executorService.shutdown()
      workers.shutdownNow()
    }

    private fun bridge(client: Socket, endpoint: URI) {
      activeSockets.add(client)
      client.use { downstream ->
        val upstream = runCatching { connect() }.getOrElse {
          activeSockets.remove(client)
          return
        }
        activeSockets.add(upstream)
        upstream.use {
          val downstreamInput = BufferedInputStream(downstream.getInputStream())
          val upstreamToDownstream = workers.submit {
            try {
              upstream.getInputStream().copyTo(downstream.getOutputStream())
            } catch (_: Throwable) {
            } finally {
              runCatching { downstream.close() }
              runCatching { upstream.close() }
            }
          }
          runCatching {
            forwardRequests(downstreamInput, upstream.getOutputStream(), authority(endpoint))
          }
          runCatching { upstream.shutdownOutput() }
          runCatching { upstreamToDownstream.get() }
        }
        activeSockets.remove(upstream)
      }
      activeSockets.remove(client)
    }

    private fun connect(): Socket =
      InnerTlsTransport.openSocket(carrierClient, saved, CONNECT_TIMEOUT_MS)

    private fun forwardRequests(input: BufferedInputStream, output: OutputStream, authority: String) {
      while (!closed) {
        val header = readHttpHeader(input) ?: return
        val request = HttpRequestHeader.parse(header)
        output.write(request.withAuthority(authority))
        when {
          request.upgrade -> {
            output.flush()
            input.copyTo(output)
            return
          }
          request.chunked -> copyChunkedBody(input, output)
          request.contentLength > 0L -> copyExactly(input, output, request.contentLength)
        }
        output.flush()
        if (request.close) return
      }
    }

    private fun copyChunkedBody(input: BufferedInputStream, output: OutputStream) {
      while (true) {
        val line = readHttpLine(input)
        output.write(line)
        val sizeText = line.toString(StandardCharsets.ISO_8859_1)
          .removeSuffix("\r\n")
          .substringBefore(';')
          .trim()
        val size = sizeText.toLongOrNull(16) ?: error("Invalid chunked request body")
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
    private const val MAX_HEADER_BYTES = 64 * 1024
    private const val STREAM_BUFFER_BYTES = 16 * 1024
    private val CRLF = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte())
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
      val transferEncoding = fields
        .filter { (name) -> name.equals("transfer-encoding", ignoreCase = true) }
        .flatMap { (_, value) -> value.split(',') }
        .map(String::trim)
      val connection = fields
        .filter { (name) -> name.equals("connection", ignoreCase = true) }
        .flatMap { (_, value) -> value.split(',') }
        .map(String::trim)
      return HttpRequestHeader(
        requestLine = requestLine,
        fields = fields,
        contentLength = contentLengths.singleOrNull() ?: 0L,
        chunked = transferEncoding.any { it.equals("chunked", ignoreCase = true) },
        close = connection.any { it.equals("close", ignoreCase = true) },
        upgrade = connection.any { it.equals("upgrade", ignoreCase = true) },
      )
    }
  }
}
