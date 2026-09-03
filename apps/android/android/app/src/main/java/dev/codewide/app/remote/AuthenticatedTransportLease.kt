package dev.codewide.app.remote

import android.util.Base64
import android.util.Log
import java.net.URI
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject

internal const val MAX_AUTHENTICATED_RESPONSE_BYTES = 16 * 1024 * 1024

internal class AuthenticatedLeaseCapacityExceededException : IllegalStateException(
  "Too many authenticated leases are open",
)

/** Process-wide admission budget; per-lease gates cannot multiply these limits. */
internal class AuthenticatedTransportCapacity(
  maximumLeases: Int,
  maximumChannels: Int,
  maximumRequests: Int,
) {
  private val leases = Semaphore(maximumLeases, true)
  private val channels = Semaphore(maximumChannels, true)
  private val requests = Semaphore(maximumRequests, true)

  fun reserveLease() {
    if (!leases.tryAcquire()) throw AuthenticatedLeaseCapacityExceededException()
  }

  fun releaseLease() = leases.release()

  fun <T> channelGate(perLeaseMaximum: Int): LeaseChannelGate<T> = LeaseChannelGate(
    perLeaseMaximum,
    onReserved = { reserve(channels, "Too many authenticated channels are open in this process") },
    onReleased = channels::release,
  )

  fun <T> requestGate(perLeaseMaximum: Int): LeaseRequestGate<T> = LeaseRequestGate(
    perLeaseMaximum,
    onReserved = { reserve(requests, "Too many authenticated requests are open in this process") },
    onReleased = requests::release,
  )

  fun availableLeases(): Int = leases.availablePermits()

  fun availableChannels(): Int = channels.availablePermits()

  fun availableRequests(): Int = requests.availablePermits()

  private fun reserve(semaphore: Semaphore, message: String) {
    check(semaphore.tryAcquire()) { message }
  }
}

internal data class AuthenticatedDuplexEvent(
  val type: String,
  val data: String? = null,
  val code: Int? = null,
)

/** Service-owned registry that keeps saved credentials, pins, routes, and native handles opaque. */
internal class AuthenticatedTransportLeaseRegistry(
  private val credentialsStore: NativeSessionCredentialsStore,
  private val credentialClient: OkHttpClient,
  private val transportClient: OkHttpClient,
  private val emit: (String) -> Unit,
  private val capacity: AuthenticatedTransportCapacity = PROCESS_CAPACITY,
) {
  private data class Lease(
    val savedServerId: String,
    val channels: LeaseChannelGate<WebSocket>,
    val requests: LeaseRequestGate<Call>,
    @Volatile var released: Boolean = false,
  )

  private data class PreparedRequest(
    val url: String,
    val method: String,
    val body: ByteArray? = null,
    val mediaType: String? = null,
    val range: String? = null,
    val responseLimit: Int = MAX_AUTHENTICATED_RESPONSE_BYTES,
    val boundedPrefixResponse: Boolean = false,
  )

  private val leases = ConcurrentHashMap<String, Lease>()
  private val observers = ConcurrentHashMap<String, (AuthenticatedDuplexEvent) -> Unit>()
  private val lifecycleLock = Any()
  @Volatile private var closed = false

  fun acquire(savedServerId: String): String = synchronized(lifecycleLock) {
    check(!closed) { "Authenticated transport registry is closed" }
    require(savedServerId.isNotBlank() && savedServerId.length <= 256) { "Saved server id is invalid" }
    val saved = credentialsStore.get(savedServerId) ?: error("Saved server is unavailable")
    require(saved.enabled) { "Saved server is disabled" }
    capacity.reserveLease()
    try {
      val handle = UUID.randomUUID().toString()
      val lease = Lease(
        savedServerId,
        capacity.channelGate(MAX_CHANNELS_PER_LEASE),
        capacity.requestGate(MAX_REQUESTS_PER_LEASE),
      )
      check(leases.putIfAbsent(handle, lease) == null) { "Could not allocate authenticated lease" }
      return@synchronized handle
    } catch (error: Throwable) {
      capacity.releaseLease()
      throw error
    }
  }

  fun openDuplex(
    handle: String,
    channelId: String,
    purpose: String,
    observer: ((AuthenticatedDuplexEvent) -> Unit)? = null,
  ) {
    requireChannelId(channelId)
    val lease = requireLease(handle)
    val path = when (purpose) {
      "sync-v2" -> "/v2/sync"
      "terminal-v2" -> "/v2/terminals"
      "voice-v2" -> "/v2/voice"
      else -> error("Authenticated channel purpose is invalid")
    }
    val key = channelKey(handle, channelId)
    val reservation = lease.channels.reserve(channelId)
    if (observer != null) observers[key] = observer
    try {
      val saved = requireSaved(lease)
      SessionCredentialClient.mint(credentialClient, saved) { result ->
        result.fold(
          onSuccess = { credential ->
            if (!current(handle, lease) || !lease.channels.contains(reservation)) return@fold
            runCatching { connectDuplex(handle, lease, reservation, purpose, path, saved, credential) }
              .onFailure {
                if (lease.channels.discard(reservation)) emitFailure(handle, channelId, "transport_failed")
              }
          },
          onFailure = {
            if (lease.channels.discard(reservation)) emitFailure(handle, channelId, "authorization_failed")
          },
        )
      }
    } catch (error: Throwable) {
      observers.remove(key)
      lease.channels.discard(reservation)
      throw error
    }
  }

  fun send(handle: String, channelId: String, data: String) {
    require(data.toByteArray(Charsets.UTF_8).size <= MAX_DUPLEX_MESSAGE_BYTES) { "Authenticated channel message is too large" }
    val socket = requireLease(handle).channels.get(channelId) ?: error("Authenticated channel is unavailable")
    check(socket.send(data)) { "Authenticated channel is not writable" }
  }

  fun closeChannel(handle: String, channelId: String, code: Int, reason: String) {
    val lease = leases[handle] ?: return
    val key = channelKey(handle, channelId)
    observers.remove(key)
    lease.channels.take(channelId)?.close(code.coerceIn(1000, 4999), reason.take(64))
  }

  fun request(handle: String, purpose: String, input: String, completion: (Result<String>) -> Unit) {
    require(input.toByteArray(Charsets.UTF_8).size <= MAX_REQUEST_BYTES) { "Authenticated request is too large" }
    val lease = requireLease(handle)
    val saved = requireSaved(lease)
    val prepared = prepareRequest(purpose, input, saved)
    val requestId = UUID.randomUUID().toString()
    lease.requests.reserve(requestId)
    try {
      SessionCredentialClient.mint(credentialClient, saved) { result ->
        result.fold(
          onSuccess = { credential ->
            runCatching { executeRequest(handle, lease, requestId, prepared, saved, credential, completion) }
              .onFailure { error ->
                lease.requests.complete(requestId)
                completion(Result.failure(IllegalStateException("Authenticated request could not start", error)))
              }
          },
          onFailure = {
            lease.requests.complete(requestId)
            completion(Result.failure(IllegalStateException("Authenticated request authorization failed")))
          },
        )
      }
    } catch (error: Throwable) {
      lease.requests.complete(requestId)
      throw error
    }
  }

  fun release(handle: String) {
    val lease = leases.remove(handle) ?: return
    lease.released = true
    observers.keys.filter { it.startsWith("$handle:") }.forEach(observers::remove)
    lease.channels.release().forEach(WebSocket::cancel)
    lease.requests.release().forEach(Call::cancel)
    capacity.releaseLease()
  }

  fun closeSavedServer(savedServerId: String) {
    leases.entries.filter { it.value.savedServerId == savedServerId }.map { it.key }.forEach(::release)
  }

  fun closeAll() = leases.keys.toList().forEach(::release)

  fun shutdown() {
    val handles = synchronized(lifecycleLock) {
      closed = true
      leases.keys.toList()
    }
    handles.forEach(::release)
  }

  private fun connectDuplex(
    handle: String,
    lease: Lease,
    reservation: LeaseChannelGate.Reservation,
    purpose: String,
    path: String,
    saved: StoredNativeSession,
    credential: MintedSessionCredential,
  ) {
    if (!current(handle, lease)) {
      lease.channels.discard(reservation)
      return
    }
    val channelId = reservation.channelId
    val endpoint = URI(saved.endpoint)
    val target = URI(endpoint.scheme, endpoint.rawAuthority, path, null, null).toString()
    val request = Request.Builder()
      .url(InnerTlsTransport.url(saved, target))
      .header("Authorization", "Bearer ${credential.token}")
      .build()
    val socket = InnerTlsTransport.client(transportClient, saved).newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(socket: WebSocket, response: Response) {
        if (!current(handle, lease) || !lease.channels.attach(reservation, socket)) {
          socket.cancel()
          return
        }
        emitEvent(handle, channelId, "open")
      }

      override fun onMessage(socket: WebSocket, text: String) {
        if (!lease.channels.owns(reservation, socket)) return
        emitEvent(handle, channelId, "message", text)
      }

      override fun onMessage(socket: WebSocket, bytes: ByteString) {
        if (!lease.channels.owns(reservation, socket) || bytes.size > MAX_DUPLEX_MESSAGE_BYTES) {
          socket.close(1009, "message_too_large")
          return
        }
        emitEvent(handle, channelId, "binary", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
      }

      override fun onClosed(socket: WebSocket, code: Int, reason: String) {
        if (lease.channels.discard(reservation)) emitEvent(handle, channelId, "close", code = code)
      }

      override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
        if (!lease.channels.discard(reservation)) return
        // Emit only a bounded transport classification. It is enough to diagnose
        // a failed opaque data channel without logging server response content.
        Log.w(
          "CodeWideTransport",
          "authenticated duplex failed purpose=${purpose.take(32)} class=${error.javaClass.simpleName.take(64)} cause=${error.cause?.javaClass?.simpleName?.take(64) ?: "none"} http=${response?.code ?: 0}",
        )
        emitFailure(
          handle,
          channelId,
          response?.code?.let { "http_$it" } ?: "transport_failed",
        )
      }
    })
    if (!current(handle, lease) || !lease.channels.attach(reservation, socket)) socket.cancel()
  }

  private fun executeRequest(
    handle: String,
    lease: Lease,
    requestId: String,
    prepared: PreparedRequest,
    saved: StoredNativeSession,
    credential: MintedSessionCredential,
    completion: (Result<String>) -> Unit,
  ) {
    if (!current(handle, lease)) {
      lease.requests.complete(requestId)
      return completion(Result.failure(IllegalStateException("Authenticated lease is released")))
    }
    val builder = Request.Builder()
      .url(prepared.url)
      .header("Authorization", "Bearer ${credential.token}")
    prepared.range?.let { builder.header("Range", it) }
    val body = prepared.body?.toRequestBody((prepared.mediaType ?: OCTET_STREAM).toMediaType())
    val request = when (prepared.method) {
      "GET" -> builder.get()
      "HEAD" -> builder.head()
      "DELETE" -> builder.delete()
      "PUT" -> builder.put(requireNotNull(body))
      "POST" -> builder.post(requireNotNull(body))
      else -> error("Authenticated request method is invalid")
    }.build()
    val call = InnerTlsTransport.client(transportClient, saved).newCall(request)
    if (!lease.requests.attach(requestId, call)) {
      call.cancel()
      return completion(Result.failure(IllegalStateException("Authenticated lease is released")))
    }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: java.io.IOException) {
        lease.requests.complete(requestId, call)
        completion(Result.failure(IllegalStateException("Authenticated request transport failed")))
      }

      override fun onResponse(call: Call, response: Response) {
        val result = runCatching {
          response.use {
            val readLimit = if (prepared.boundedPrefixResponse) prepared.responseLimit else prepared.responseLimit + 1
            val body = response.body?.byteStream()?.use { stream -> stream.readNBytes(readLimit) } ?: ByteArray(0)
            check(current(handle, lease)) { "Authenticated lease is released" }
            check(prepared.boundedPrefixResponse || body.size <= prepared.responseLimit) {
              "Authenticated response is too large"
            }
            JSONObject()
              .put("status", response.code)
              .put("contentType", response.header("Content-Type")?.take(128) ?: "application/octet-stream")
              .put("bodyBase64", Base64.encodeToString(body, Base64.NO_WRAP))
              .toString()
          }
        }
        // The call stays lease-owned until its response body has been fully consumed.
        // Releasing the lease therefore cancels an in-flight body, not only its headers.
        lease.requests.complete(requestId, call)
        completion(result.fold(
          onSuccess = { Result.success(it) },
          onFailure = { Result.failure(IllegalStateException("Authenticated response could not be read", it)) },
        ))
      }
    })
  }

  private fun prepareRequest(purpose: String, raw: String, saved: StoredNativeSession): PreparedRequest {
    val input = JSONObject(raw)
    val operation = input.requireBoundedString("operation", 64)
    val route = routeBuilder(saved)
    return when (operation) {
      "file.download" -> {
        require(purpose == "files-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "rootId", "path", "head")
        route.addPathSegments("v2/files/download")
          .addQueryParameter("rootId", input.requireBoundedString("rootId", 256))
          .addQueryParameter("path", input.requireBoundedString("path", MAX_PATH_CHARS))
        PreparedRequest(route.build().toString(), if (input.getBoolean("head")) "HEAD" else "GET")
      }
      "file.preview" -> {
        require(purpose == "files-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "path", "head")
        route.addPathSegments("v2/files/preview")
          .addQueryParameter("path", input.requireBoundedString("path", MAX_PATH_CHARS))
        PreparedRequest(route.build().toString(), if (input.getBoolean("head")) "HEAD" else "GET")
      }
      "file.upload", "file.uploadStatus", "file.uploadCancel" -> {
        require(purpose == "files-v2") { "Authenticated request purpose does not match operation" }
        val upload = operation == "file.upload"
        if (upload) input.requireExactKeys("operation", "rootId", "path", "bodyBase64")
        else input.requireExactKeys("operation", "rootId", "path")
        route.addPathSegments("v2/files/upload")
          .addQueryParameter("rootId", input.requireBoundedString("rootId", 256))
          .addQueryParameter("path", input.requireBoundedString("path", MAX_PATH_CHARS))
        PreparedRequest(
          route.build().toString(),
          when (operation) {
            "file.upload" -> "PUT"
            "file.uploadStatus" -> "HEAD"
            else -> "DELETE"
          },
          if (upload) Base64.decode(input.getString("bodyBase64"), Base64.DEFAULT) else null,
        )
      }
      "content.read" -> {
        require(purpose == "files-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "digest", "offset", "limit", "head")
        route.addPathSegments("v2/content").addPathSegment(input.requireBoundedString("digest", 256))
        input.optionalNonNegativeLong("offset")?.let { route.addQueryParameter("offset", it.toString()) }
        input.optionalNonNegativeLong("limit")?.let { route.addQueryParameter("limit", it.toString()) }
        PreparedRequest(route.build().toString(), if (input.getBoolean("head")) "HEAD" else "GET")
      }
      "media.materialize" -> {
        require(purpose == "media-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "sourceUrl")
        route.addPathSegments("v2/media/materialize")
        val body = JSONObject().put("url", input.requireBoundedString("sourceUrl", MAX_PATH_CHARS)).toString()
        PreparedRequest(route.build().toString(), "POST", body.toByteArray(Charsets.UTF_8), JSON_MEDIA_TYPE)
      }
      "media.streamCreate" -> {
        require(purpose == "media-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "sourceUrl")
        route.addPathSegments("v2/media/streams")
        val body = JSONObject().put("url", input.requireBoundedString("sourceUrl", MAX_PATH_CHARS)).toString()
        PreparedRequest(route.build().toString(), "POST", body.toByteArray(Charsets.UTF_8), JSON_MEDIA_TYPE)
      }
      "media.streamRead" -> {
        require(purpose == "media-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "id", "offset", "limit", "head")
        val offset = input.requireNonNegativeLong("offset")
        val limit = input.requirePositiveInt("limit", MAX_AUTHENTICATED_RESPONSE_BYTES)
        route.addPathSegments("v2/media/streams").addPathSegment(input.requireBoundedString("id", 256))
        PreparedRequest(
          url = route.build().toString(),
          method = if (input.getBoolean("head")) "HEAD" else "GET",
          range = boundedByteRange(offset, limit),
          responseLimit = limit,
          boundedPrefixResponse = true,
        )
      }
      "media.read" -> {
        require(purpose == "media-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "id", "head")
        route.addPathSegments("v2/media").addPathSegment(input.requireBoundedString("id", 256))
        PreparedRequest(route.build().toString(), if (input.getBoolean("head")) "HEAD" else "GET")
      }
      "ports.list" -> {
        require(purpose == "ports-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation")
        route.addPathSegments("v2/ports")
        PreparedRequest(route.build().toString(), "GET")
      }
      "tunnel.create" -> {
        require(purpose == "tunnels-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "port", "ttlSeconds")
        val port = input.getInt("port")
        require(port in 1..65_535) { "Tunnel port is invalid" }
        val ttl = input.optionalNonNegativeLong("ttlSeconds")
        require(ttl == null || ttl in 30..3_600) { "Tunnel TTL is invalid" }
        route.addPathSegments("v2/tunnels")
        val body = JSONObject().put("port", port).put("ttlSeconds", ttl ?: JSONObject.NULL).toString()
        PreparedRequest(route.build().toString(), "POST", body.toByteArray(Charsets.UTF_8), JSON_MEDIA_TYPE)
      }
      "tunnel.delete" -> {
        require(purpose == "tunnels-v2") { "Authenticated request purpose does not match operation" }
        input.requireExactKeys("operation", "tunnelId")
        route.addPathSegments("v2/tunnels").addPathSegment(input.requireBoundedString("tunnelId", 256))
        PreparedRequest(route.build().toString(), "DELETE")
      }
      else -> error("Authenticated request operation is invalid")
    }
  }

  private fun routeBuilder(saved: StoredNativeSession): HttpUrl.Builder {
    return authenticatedRequestBase(saved.endpoint).newBuilder()
  }

  private fun requireLease(handle: String): Lease {
    require(handle.matches(UUID_PATTERN)) { "Authenticated lease handle is invalid" }
    return leases[handle]?.takeUnless { it.released } ?: error("Authenticated lease is unavailable")
  }

  private fun requireSaved(lease: Lease): StoredNativeSession {
    val saved = credentialsStore.get(lease.savedServerId) ?: error("Saved server is unavailable")
    require(saved.enabled) { "Saved server is disabled" }
    return saved
  }

  private fun current(handle: String, lease: Lease): Boolean = !lease.released && leases[handle] === lease

  private fun emitFailure(handle: String, channelId: String, reason: String) =
    emitEvent(handle, channelId, "error", reason.take(64))

  private fun emitEvent(handle: String, channelId: String, type: String, data: String? = null, code: Int? = null) {
    runCatching { observers[channelKey(handle, channelId)]?.invoke(AuthenticatedDuplexEvent(type, data, code)) }
    if (type == "close" || type == "error") observers.remove(channelKey(handle, channelId))
    emit(JSONObject()
      .put("leaseHandle", handle)
      .put("channelId", channelId)
      .put("type", type)
      .apply {
        if (data != null) put("data", data)
        if (code != null) put("code", code)
      }
      .toString())
  }

  private fun requireChannelId(channelId: String) {
    require(channelId.matches(UUID_PATTERN)) { "Authenticated channel id is invalid" }
  }

  private fun channelKey(handle: String, channelId: String): String = "$handle:$channelId"

  private fun JSONObject.requireExactKeys(vararg expected: String) {
    require(keys().asSequence().toSet() == expected.toSet()) { "Authenticated request fields are invalid" }
  }

  private fun JSONObject.requireBoundedString(name: String, maxChars: Int): String =
    getString(name).also { require(it.isNotEmpty() && it.length <= maxChars) { "Authenticated request field is invalid" } }

  private fun JSONObject.optionalNonNegativeLong(name: String): Long? =
    if (isNull(name)) null else getLong(name).also { require(it >= 0) { "Authenticated request field is invalid" } }

  private fun JSONObject.requireNonNegativeLong(name: String): Long =
    getLong(name).also { require(it >= 0) { "Authenticated request field is invalid" } }

  private fun JSONObject.requirePositiveInt(name: String, maximum: Int): Int =
    getInt(name).also { require(it in 1..maximum) { "Authenticated request field is invalid" } }

  private companion object {
    val PROCESS_CAPACITY = AuthenticatedTransportCapacity(
      MAX_LEASES_PER_PROCESS,
      MAX_CHANNELS_PER_PROCESS,
      MAX_REQUESTS_PER_PROCESS,
    )
    val UUID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    const val JSON_MEDIA_TYPE = "application/json; charset=utf-8"
    const val OCTET_STREAM = "application/octet-stream"
    const val MAX_CHANNELS_PER_LEASE = 8
    const val MAX_REQUESTS_PER_LEASE = 16
    const val MAX_LEASES_PER_PROCESS = 64
    const val MAX_CHANNELS_PER_PROCESS = 64
    // Preserve one lease's existing request concurrency without allowing it to
    // multiply by the number of cheap opaque handles.
    const val MAX_REQUESTS_PER_PROCESS = MAX_REQUESTS_PER_LEASE
    const val MAX_DUPLEX_MESSAGE_BYTES = 4 * 1024 * 1024
    const val MAX_REQUEST_BYTES = 4 * 1024 * 1024
    const val MAX_PATH_CHARS = 16 * 1024
  }
}

/** Builds the single closed range used by bounded asset reads and rejects overflow. */
internal fun boundedByteRange(offset: Long, limit: Int): String {
  require(offset >= 0 && limit in 1..MAX_AUTHENTICATED_RESPONSE_BYTES) { "Authenticated byte range is invalid" }
  val end = Math.addExact(offset, limit.toLong() - 1)
  return "bytes=$offset-$end"
}

internal fun authenticatedRequestBase(endpoint: String): HttpUrl {
  val uri = URI(endpoint)
  val scheme = when (uri.scheme) {
    "http", "https", "ws", "wss" -> "https"
    else -> error("Unsupported companion URL scheme")
  }
  return URI(scheme, uri.rawAuthority, "/", null, null).toString().toHttpUrl()
}
