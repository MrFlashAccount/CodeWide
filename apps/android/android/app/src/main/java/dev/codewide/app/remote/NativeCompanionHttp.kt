package dev.codewide.app.remote

import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.Buffer
import okio.source

/**
 * Executes Companion HTTP requests for React Native through the profile-scoped
 * pinned inner-TLS client. OkHttp owns pooling and HTTP/2 multiplexing, so
 * concurrent transfers share one tunnel and every failure reaches the caller
 * with its cause instead of surfacing as a closed loopback socket.
 */
internal class NativeCompanionHttp(
  private val credentials: (String) -> StoredNativeSession?,
  private val clientFor: (StoredNativeSession) -> OkHttpClient,
  private val files: NativeCompanionHttpFiles,
  private val originFor: (StoredNativeSession) -> HttpUrl = ::companionOrigin,
) : Closeable {
  private val clients = ConcurrentHashMap<String, PinnedClient>()
  private val calls = ConcurrentHashMap<String, Call>()

  fun execute(request: CompanionHttpRequest, completion: (Result<CompanionHttpResult>) -> Unit) {
    val (client, call) = try {
      val saved = credentials(request.connectionId) ?: error("Saved native credentials are missing")
      require(saved.enabled) { "Connection is disabled" }
      val client = client(saved)
      client to client.newCall(okHttpRequest(saved, request))
    } catch (error: Throwable) {
      completion(Result.failure(error))
      return
    }
    if (calls.putIfAbsent(request.requestId, call) != null) {
      completion(Result.failure(IllegalStateException("Companion HTTP request id is already active")))
      return
    }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        calls.remove(request.requestId, call)
        // JavaScript cancels a request whose response did not arrive within its budget.
        // Cancelling an HTTP/2 call only resets its stream and keeps the connection
        // pooled, so the retry would reuse the same stalled tunnel. By now the call
        // has released its connection; close it and every other idle connection of
        // this authority so the next request opens a fresh tunnel.
        if (call.isCanceled()) evict(client)
        completion(Result.failure(e))
      }

      override fun onResponse(call: Call, response: Response) {
        val result = runCatching { response.use { receive(it, request.sink) } }
        calls.remove(request.requestId, call)
        completion(result)
      }
    })
  }

  /**
   * Executes a request that a React Native view issued for a [CompanionAddress]. The caller's
   * headers and body are preserved; only the scheme and authority become the pinned Companion.
   */
  fun proceed(address: CompanionAddress, request: Request): Response {
    val saved = credentials(address.connectionId) ?: throw IOException("Saved native credentials are missing")
    if (!saved.enabled) throw IOException("Connection is disabled")
    val url = companionUrl(saved, address.pathAndQuery)
    return client(saved).newCall(request.newBuilder().url(url).build()).execute()
  }

  fun cancel(requestId: String) {
    calls.remove(requestId)?.cancel()
  }

  /**
   * Closes idle pooled tunnels of every authority after the default network changes.
   * Their carriers belong to the previous route and can stall silently until a ping
   * fails; in-flight calls keep their connections and finish or fail on their own.
   */
  fun retireIdleConnections() {
    clients.values.forEach { evict(it.client) }
  }

  /** Closes pooled tunnels derived from a revoked, disabled or replaced authority. */
  fun remove(connectionId: String) {
    clients.remove(connectionId)?.client?.let(::evict)
  }

  override fun close() {
    calls.values.forEach(Call::cancel)
    calls.clear()
    clients.values.forEach { evict(it.client) }
    clients.clear()
  }

  private fun client(saved: StoredNativeSession): OkHttpClient {
    val existing = clients[saved.id]
    if (existing != null && existing.saved == saved) return existing.client
    val replacement = PinnedClient(saved, clientFor(saved))
    clients.put(saved.id, replacement)?.client?.let(::evict)
    return replacement.client
  }

  private fun okHttpRequest(saved: StoredNativeSession, request: CompanionHttpRequest): Request {
    val builder = Request.Builder().url(companionUrl(saved, request.path))
    request.headers.forEach { (name, value) -> builder.addHeader(name, value) }
    val contentType = request.headers.lastOrNull { (name) -> name.equals("content-type", ignoreCase = true) }
      ?.second?.toMediaTypeOrNull()
    val body = when (val requestBody = request.body) {
      CompanionHttpBody.None -> if (request.method in METHODS_REQUIRING_BODY) ByteArray(0).toRequestBody(contentType) else null
      is CompanionHttpBody.Text -> requestBody.text.toByteArray(Charsets.UTF_8).toRequestBody(contentType)
      is CompanionHttpBody.FileSlice -> FileSliceBody(files, requestBody, contentType)
    }
    return builder.method(request.method, body).build()
  }

  private fun companionUrl(saved: StoredNativeSession, pathAndQuery: String): HttpUrl =
    originFor(saved).newBuilder()
      .encodedPath(pathAndQuery.substringBefore('?'))
      .encodedQuery(pathAndQuery.substringAfter('?', "").ifEmpty { null })
      .build()

  private fun receive(response: Response, sink: CompanionHttpSink): CompanionHttpResult {
    val headers = response.headers.names().map { name -> name to response.headers.values(name).joinToString(", ") }
    val body = response.body
    if (sink is CompanionHttpSink.File && response.isSuccessful && body != null) {
      val bytes = files.openOutput(sink.uri, sink.append).use { output -> copy(body.byteStream(), output) }
      return CompanionHttpResult(response.code, headers, CompanionHttpPayload.File(bytes))
    }
    if (sink == CompanionHttpSink.Discard || body == null) {
      return CompanionHttpResult(response.code, headers, CompanionHttpPayload.None)
    }
    // A failed file transfer returns its bounded error body instead of writing it into the destination.
    val limit = if (sink == CompanionHttpSink.Text) MAX_TEXT_BYTES else MAX_ERROR_BYTES
    val source = body.source()
    val buffer = Buffer()
    while (buffer.size <= limit && source.read(buffer, STREAM_BUFFER_BYTES.toLong()) != -1L) Unit
    if (buffer.size > limit) {
      if (sink == CompanionHttpSink.Text) throw IOException("Companion response exceeds ${MAX_TEXT_BYTES / MIB} MiB")
      return CompanionHttpResult(response.code, headers, CompanionHttpPayload.Text(buffer.readUtf8(limit)))
    }
    return CompanionHttpResult(response.code, headers, CompanionHttpPayload.Text(buffer.readUtf8()))
  }

  private class PinnedClient(val saved: StoredNativeSession, val client: OkHttpClient)

  private class FileSliceBody(
    private val files: NativeCompanionHttpFiles,
    private val slice: CompanionHttpBody.FileSlice,
    private val contentType: MediaType?,
  ) : RequestBody() {
    override fun contentType(): MediaType? = contentType

    override fun contentLength(): Long = slice.length

    override fun writeTo(sink: BufferedSink) {
      files.openInput(slice.uri).use { input ->
        skipExactly(input, slice.offset)
        val source = input.source()
        var remaining = slice.length
        while (remaining > 0L) {
          val count = source.read(sink.buffer, minOf(remaining, STREAM_BUFFER_BYTES.toLong()))
          if (count == -1L) throw IOException("Upload file ended before the requested range")
          remaining -= count
          sink.emitCompleteSegments()
        }
      }
    }
  }

  companion object {
    private val METHODS_REQUIRING_BODY = setOf("POST", "PUT", "PATCH")
    private const val MIB = 1024 * 1024
    private const val MAX_TEXT_BYTES = 16L * MIB
    private const val MAX_ERROR_BYTES = 4L * 1024
    private const val STREAM_BUFFER_BYTES = 64 * 1024

    private fun companionOrigin(saved: StoredNativeSession): HttpUrl {
      val endpoint = URI(InnerTlsTransport.url(saved, saved.endpoint))
      return URI("https", endpoint.rawAuthority, "/", null, null).toString().toHttpUrl()
    }

    private fun evict(client: OkHttpClient) {
      client.connectionPool.evictAll()
    }

    private fun copy(input: InputStream, output: OutputStream): Long {
      var total = 0L
      val buffer = ByteArray(STREAM_BUFFER_BYTES)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) return total
        output.write(buffer, 0, count)
        total += count
      }
    }

    private fun skipExactly(input: InputStream, byteCount: Long) {
      var remaining = byteCount
      while (remaining > 0L) {
        val skipped = input.skip(remaining)
        if (skipped > 0L) {
          remaining -= skipped
        } else if (input.read() == -1) {
          throw IOException("Upload file ended before the requested offset")
        } else {
          remaining -= 1
        }
      }
    }
  }
}

/** Opens app-private `file:` and Storage Access Framework `content:` URIs for transfer bodies. */
internal interface NativeCompanionHttpFiles {
  fun openInput(uri: String): InputStream

  fun openOutput(uri: String, append: Boolean): OutputStream
}

internal data class CompanionHttpRequest(
  val requestId: String,
  val connectionId: String,
  val method: String,
  val path: String,
  val headers: List<Pair<String, String>>,
  val body: CompanionHttpBody,
  val sink: CompanionHttpSink,
) {
  init {
    require(REQUEST_ID.matches(requestId)) { "Companion HTTP request id is invalid" }
    require(connectionId.isNotBlank()) { "Connection id is required" }
    require(method in METHODS) { "Companion HTTP method is not supported" }
    require(isCompanionApiPath(path)) { "Companion HTTP path is invalid" }
    headers.forEach { (name, value) ->
      require(HEADER_NAME.matches(name) && name.lowercase() !in TRANSPORT_HEADERS) { "Companion HTTP header is not allowed" }
      require(value.none { it == '\r' || it == '\n' }) { "Companion HTTP header value is invalid" }
    }
    require(body == CompanionHttpBody.None || method in setOf("POST", "PUT", "PATCH")) {
      "Companion HTTP method does not accept a body"
    }
  }

  private companion object {
    val REQUEST_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    val HEADER_NAME = Regex("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
    val METHODS = setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
    val TRANSPORT_HEADERS = setOf("host", "connection", "content-length", "transfer-encoding", "upgrade", "te")
  }
}

internal sealed interface CompanionHttpBody {
  data object None : CompanionHttpBody

  data class Text(val text: String) : CompanionHttpBody

  data class FileSlice(val uri: String, val offset: Long, val length: Long) : CompanionHttpBody {
    init {
      require(offset >= 0L && length >= 0L) { "Upload file range is invalid" }
    }
  }
}

internal sealed interface CompanionHttpSink {
  data object Discard : CompanionHttpSink

  data object Text : CompanionHttpSink

  /** Writes only a successful body; `append` continues a ranged download in place. */
  data class File(val uri: String, val append: Boolean) : CompanionHttpSink
}

internal sealed interface CompanionHttpPayload {
  data object None : CompanionHttpPayload

  data class Text(val text: String) : CompanionHttpPayload

  data class File(val bytes: Long) : CompanionHttpPayload
}

internal data class CompanionHttpResult(
  val status: Int,
  val headers: List<Pair<String, String>>,
  val payload: CompanionHttpPayload,
)

/**
 * Only an origin-relative Companion API path; the native client owns scheme and authority.
 * Dot segments are rejected because OkHttp resolves them and could leave `/v1/`.
 */
internal fun isCompanionApiPath(path: String): Boolean {
  val segments = path.substringBefore('?').split('/')
  return path.startsWith("/v1/") &&
    !path.contains("//") &&
    path.none { it.isISOControl() || it == ' ' } &&
    segments.none { segment -> segment.lowercase().replace("%2e", ".") in DOT_SEGMENTS }
}

private val DOT_SEGMENTS = setOf(".", "..")
