package dev.codewide.app.remote

import android.content.Context
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

internal data class PortForwardProjection(
  val profile: StoredPortForward,
  val localPort: Int?,
  val status: String,
  val error: String?,
) {
  fun json(): JSONObject = JSONObject().apply {
    put("id", profile.id)
    put("connectionId", profile.connectionId)
    put("label", profile.label)
    put("remoteHost", "127.0.0.1")
    put("remotePort", profile.remotePort)
    put("preferredLocalPort", profile.preferredLocalPort ?: JSONObject.NULL)
    put("serviceKey", profile.serviceKey ?: JSONObject.NULL)
    put("preference", profile.preference)
    put("localPort", localPort ?: JSONObject.NULL)
    put("enabled", profile.enabled)
    put("status", status)
    put("previewUrl", if (localPort == null || status != "live") JSONObject.NULL else "http://127.0.0.1:$localPort/")
    put("error", error ?: JSONObject.NULL)
    put("updatedAt", profile.updatedAt)
  }
}

/** Owns phone loopback listeners and their opaque WebSocket-to-TCP streams. */
internal class NativePortForwardManager(
  context: Context,
  private val credentialsStore: NativeSessionCredentialsStore,
  private val baseClient: OkHttpClient,
) {
  private data class CachedCredential(val value: MintedSessionCredential)
  private data class Runtime(
    val profileId: String,
    val serverSocket: ServerSocket,
    val clients: MutableSet<Socket> = ConcurrentHashMap.newKeySet(),
    val webSockets: MutableSet<WebSocket> = ConcurrentHashMap.newKeySet(),
    val closed: AtomicBoolean = AtomicBoolean(false),
  )

  private val store = NativePortForwardStore(context)
  private val runtimes = ConcurrentHashMap<String, Runtime>()
  private val projections = ConcurrentHashMap<String, PortForwardProjection>()
  private val availablePorts = ConcurrentHashMap<String, Set<Int>>()
  private val credentialCache = ConcurrentHashMap<String, CachedCredential>()
  private val credentialLocks = ConcurrentHashMap<String, Any>()

  fun restore() {
    val enabled = store.list().filter { it.enabled && it.preference != "excluded" }
    enabled.forEach { start(it.id) }
    enabled.map { it.connectionId }.distinct().forEach { connectionId ->
      thread(name = "CodeWideForwardDiscovery-${safeId(connectionId)}", isDaemon = true) {
        runCatching { discover(connectionId) }
      }
    }
  }

  fun list(connectionId: String): List<PortForwardProjection> = store.list(connectionId)
    .sortedWith(compareByDescending<StoredPortForward> { it.enabled }.thenByDescending { it.updatedAt })
    .map { profile -> projections[profile.id] ?: PortForwardProjection(profile, null, if (profile.enabled) "connecting" else "stopped", null) }

  fun discover(connectionId: String): String {
    val saved = credentialsStore.get(connectionId) ?: error("Saved server credentials are missing")
    require(saved.enabled) { "Server connection is disabled" }
    return discover(saved, allowCredentialRetry = true)
  }

  fun upsert(
    connectionId: String,
    profileId: String,
    label: String,
    remotePort: Int,
    preferredLocalPort: Int?,
    serviceKey: String?,
    preference: String,
  ): PortForwardProjection {
    val previous = store.get(profileId)
    require(previous == null || previous.connectionId == connectionId) { "Port forward belongs to another server" }
    val profile = store.upsert(
      StoredPortForward(
        id = profileId,
        connectionId = connectionId,
        label = label.trim(),
        remotePort = remotePort,
        preferredLocalPort = preferredLocalPort,
        serviceKey = serviceKey,
        preference = preference,
        enabled = preference != "excluded" && (previous?.enabled ?: false),
        updatedAt = System.currentTimeMillis(),
      ),
    )
    val wasRunning = runtimes.containsKey(profileId)
    val transportChanged = previous == null
      || previous.remotePort != profile.remotePort
      || previous.preferredLocalPort != profile.preferredLocalPort
    if (wasRunning && profile.preference == "excluded") {
      stopRuntime(profileId, persistDisabled = false)
      return projection(profile, null, "stopped", null).also(::publish)
    } else if (wasRunning && transportChanged) {
      stopRuntime(profileId, persistDisabled = false)
      return start(profileId)
    } else if (wasRunning) {
      val current = projections[profileId]
      val runtime = runtimes[profileId] ?: error("Port forward runtime disappeared")
      return projection(
        profile,
        runtime.serverSocket.localPort,
        current?.status ?: "live",
        current?.error,
      ).also(::publish)
    }
    return PortForwardProjection(profile, null, "stopped", null).also(::publish)
  }

  fun start(profileId: String): PortForwardProjection {
    runtimes[profileId]?.let { runtime ->
      return projections[profileId] ?: projection(store.get(profileId) ?: error("Port forward not found"), runtime.serverSocket.localPort, "live", null)
    }
    val profile = store.setEnabled(profileId, true) ?: error("Port forward not found")
    if (profile.preference == "excluded") {
      return projection(profile, null, "stopped", null).also(::publish)
    }
    val credentials = credentialsStore.get(profile.connectionId)
    if (credentials?.enabled != true) {
      return projection(profile, null, "error", "Server connection is disabled").also(::publish)
    }
    val connecting = projection(profile, null, "connecting", null)
    publish(connecting)
    thread(name = "CodeWideForwardBind-${safeId(profile.id)}", isDaemon = true) {
      try {
        val socket = ServerSocket().apply {
          reuseAddress = true
          bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), profile.preferredLocalPort ?: 0), LISTENER_BACKLOG)
        }
        val runtime = Runtime(profile.id, socket)
        val replaced = runtimes.putIfAbsent(profile.id, runtime)
        if (replaced != null) {
          socket.close()
          return@thread
        }
        val confirmedPorts = availablePorts[profile.connectionId]
        val status = if (confirmedPorts != null && profile.remotePort !in confirmedPorts) "unavailable" else "live"
        val error = if (status == "unavailable") unavailableMessage(profile.remotePort) else null
        publish(projection(profile, socket.localPort, status, error))
        accept(profile, runtime)
      } catch (error: Throwable) {
        if (store.get(profile.id)?.enabled == true) {
          publish(projection(store.get(profile.id) ?: profile, null, "error", diagnostic(error, "Could not open phone port")))
        }
      }
    }
    return connecting
  }

  fun stop(profileId: String): PortForwardProjection {
    val profile = store.setEnabled(profileId, false) ?: error("Port forward not found")
    stopRuntime(profileId, persistDisabled = false)
    return projection(profile, null, "stopped", null).also(::publish)
  }

  fun remove(profileId: String) {
    stopRuntime(profileId, persistDisabled = false)
    store.remove(profileId)
    projections.remove(profileId)
    CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "removed").put("id", profileId).toString())
  }

  fun resumeConnection(connectionId: String) {
    store.list(connectionId).filter { it.enabled }.forEach { start(it.id) }
  }

  fun suspendConnection(connectionId: String) {
    store.list(connectionId).forEach { profile ->
      stopRuntime(profile.id, persistDisabled = false)
      publish(projection(profile, null, "stopped", null))
    }
    credentialCache.remove(connectionId)
  }

  fun removeConnection(connectionId: String) {
    store.list(connectionId).forEach { stopRuntime(it.id, persistDisabled = false) }
    store.removeConnection(connectionId)
    credentialCache.remove(connectionId)
    availablePorts.remove(connectionId)
  }

  fun close() {
    runtimes.keys.toList().forEach { stopRuntime(it, persistDisabled = false) }
    credentialCache.clear()
  }

  private fun accept(profile: StoredPortForward, runtime: Runtime) {
    while (!runtime.closed.get()) {
      val client = try {
        runtime.serverSocket.accept()
      } catch (_: IOException) {
        break
      }
      if (!client.inetAddress.isLoopbackAddress || runtime.clients.size >= MAX_CLIENTS_PER_PROFILE) {
        client.close()
        continue
      }
      client.tcpNoDelay = true
      runtime.clients.add(client)
      thread(name = "CodeWideForward-${safeId(profile.id)}", isDaemon = true) {
        bridge(profile, runtime, client)
      }
    }
  }

  private fun bridge(profile: StoredPortForward, runtime: Runtime, client: Socket) {
    var webSocket: WebSocket? = null
    val closed = AtomicBoolean(false)
    val close = {
      if (closed.compareAndSet(false, true)) {
        runtime.clients.remove(client)
        webSocket?.let(runtime.webSockets::remove)
        runCatching { client.close() }
        webSocket?.close(1000, "phone_connection_closed")
      }
      Unit
    }
    try {
      val saved = credentialsStore.get(profile.connectionId) ?: error("Saved server credentials are missing")
      require(saved.enabled) { "Server connection is disabled" }
      val credential = credential(saved)
      val request = Request.Builder()
        .url(portForwardEndpoint(saved.endpoint, profile.remotePort))
        .header("Authorization", "Bearer ${credential.token}")
        .build()
      val clientForServer = if (saved.tlsPinSha256 == null) baseClient else {
        baseClient.newBuilder()
          .certificatePinner(CertificatePinner.Builder().add(request.url.host, saved.tlsPinSha256).build())
          .build()
      }
      webSocket = clientForServer.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(socket: WebSocket, response: Response) {
          runtime.webSockets.add(socket)
          publishIfChanged(projection(store.get(profile.id) ?: profile, runtime.serverSocket.localPort, "live", null))
          thread(name = "CodeWideForwardUpload-${safeId(profile.id)}", isDaemon = true) {
            try {
              val input = client.getInputStream()
              val buffer = ByteArray(STREAM_CHUNK_BYTES)
              while (!closed.get()) {
                val count = input.read(buffer)
                if (count < 0) break
                while (!closed.get() && socket.queueSize() > MAX_WEBSOCKET_QUEUE_BYTES) Thread.sleep(10)
                if (!socket.send(buffer.toByteString(0, count))) throw IOException("Remote stream closed")
              }
            } catch (_: Throwable) {
              // The paired close path reports only one compact profile state.
            } finally {
              close()
            }
          }
        }

        override fun onMessage(socket: WebSocket, bytes: ByteString) {
          try {
            synchronized(client) {
              client.getOutputStream().write(bytes.toByteArray())
              client.getOutputStream().flush()
            }
          } catch (_: Throwable) {
            close()
          }
        }

        override fun onMessage(socket: WebSocket, text: String) {
          publishIfChanged(projection(store.get(profile.id) ?: profile, runtime.serverSocket.localPort, "error", "Invalid text frame from server"))
          close()
        }

        override fun onClosed(socket: WebSocket, code: Int, reason: String) = close()

        override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
          if (response?.code == 401 || response?.code == 403) credentialCache.remove(profile.connectionId)
          publishIfChanged(
            projection(
              store.get(profile.id) ?: profile,
              runtime.serverSocket.localPort,
              if (response?.code == 502) "unavailable" else "error",
              if (response?.code == 502) unavailableMessage(profile.remotePort)
              else diagnostic(error, "Port forward connection failed"),
            ),
          )
          close()
        }
      })
    } catch (error: Throwable) {
      publishIfChanged(projection(store.get(profile.id) ?: profile, runtime.serverSocket.localPort, "error", diagnostic(error, "Port forward connection failed")))
      close()
    }
  }

  private fun credential(saved: StoredNativeSession): MintedSessionCredential {
    credentialCache[saved.id]?.value?.takeIf { it.expiresAt - CREDENTIAL_EXPIRY_LEAD_MS > System.currentTimeMillis() }?.let { return it }
    val lock = credentialLocks.getOrPut(saved.id) { Any() }
    synchronized(lock) {
      credentialCache[saved.id]?.value?.takeIf { it.expiresAt - CREDENTIAL_EXPIRY_LEAD_MS > System.currentTimeMillis() }?.let { return it }
      val latch = CountDownLatch(1)
      var result: Result<MintedSessionCredential>? = null
      SessionCredentialClient.mint(baseClient, saved.endpoint, saved.token, saved.tlsPinSha256) {
        result = it
        latch.countDown()
      }
      check(latch.await(CREDENTIAL_TIMEOUT_MS, TimeUnit.MILLISECONDS)) { "Port forward authorization timed out" }
      val value = result?.getOrThrow() ?: error("Port forward authorization failed")
      credentialCache[saved.id] = CachedCredential(value)
      return value
    }
  }

  private fun discover(saved: StoredNativeSession, allowCredentialRetry: Boolean): String {
    val credential = credential(saved)
    val request = Request.Builder()
      .url(portDiscoveryEndpoint(saved.endpoint))
      .header("Authorization", "Bearer ${credential.token}")
      .get()
      .build()
    val clientForServer = (if (saved.tlsPinSha256 == null) baseClient else {
      baseClient.newBuilder()
        .certificatePinner(CertificatePinner.Builder().add(request.url.host, saved.tlsPinSha256).build())
        .build()
    }).newBuilder()
      .callTimeout(DISCOVERY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .readTimeout(DISCOVERY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .build()
    clientForServer.newCall(request).execute().use { response ->
      if ((response.code == 401 || response.code == 403) && allowCredentialRetry) {
        credentialCache.remove(saved.id)
        return discover(saved, allowCredentialRetry = false)
      }
      check(response.isSuccessful) { "Port discovery failed (${response.code})" }
      val body = response.body?.string() ?: error("Port discovery returned an empty response")
      require(body.length <= MAX_DISCOVERY_RESPONSE_CHARS) { "Port discovery response is too large" }
      val envelope = JSONTokener(body).nextValue() as? JSONObject ?: error("Port discovery response is invalid")
      val rows = envelope.optJSONArray("ports") ?: error("Port discovery response is invalid")
      val discovered = buildSet {
        for (index in 0 until rows.length()) add(rows.getJSONObject(index).getInt("port"))
      }
      availablePorts[saved.id] = discovered
      reconcileAvailability(saved.id, discovered)
      return body
    }
  }

  private fun reconcileAvailability(connectionId: String, discovered: Set<Int>) {
    store.list(connectionId).filter { it.enabled }.forEach { profile ->
      val runtime = runtimes[profile.id] ?: return@forEach
      val status = if (profile.remotePort in discovered) "live" else "unavailable"
      publishIfChanged(projection(
        profile,
        runtime.serverSocket.localPort,
        status,
        if (status == "unavailable") unavailableMessage(profile.remotePort) else null,
      ))
    }
  }

  private fun stopRuntime(profileId: String, persistDisabled: Boolean) {
    if (persistDisabled) store.setEnabled(profileId, false)
    val runtime = runtimes.remove(profileId) ?: return
    runtime.closed.set(true)
    runCatching { runtime.serverSocket.close() }
    runtime.clients.toList().forEach { runCatching { it.close() } }
    runtime.webSockets.toList().forEach { it.close(1000, "port_forward_stopped") }
    runtime.clients.clear()
    runtime.webSockets.clear()
  }

  private fun projection(profile: StoredPortForward, localPort: Int?, status: String, error: String?): PortForwardProjection =
    PortForwardProjection(profile, localPort, status, error?.take(240))

  private fun publishIfChanged(next: PortForwardProjection) {
    val previous = projections[next.profile.id]
    if (previous?.status == next.status && previous.error == next.error && previous.localPort == next.localPort && previous.profile == next.profile) return
    publish(next)
  }

  private fun publish(next: PortForwardProjection) {
    projections[next.profile.id] = next
    CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "profile").put("profile", next.json()).toString())
  }

  companion object {
    private const val LISTENER_BACKLOG = 32
    private const val MAX_CLIENTS_PER_PROFILE = 64
    private const val STREAM_CHUNK_BYTES = 64 * 1024
    private const val MAX_WEBSOCKET_QUEUE_BYTES = 4L * 1024 * 1024
    private const val CREDENTIAL_TIMEOUT_MS = 20_000L
    private const val CREDENTIAL_EXPIRY_LEAD_MS = 30_000L
    private const val DISCOVERY_TIMEOUT_MS = 10_000L
    private const val MAX_DISCOVERY_RESPONSE_CHARS = 256 * 1024

    internal fun portForwardEndpoint(syncEndpoint: String, remotePort: Int): String {
      require(remotePort in 1..65_535) { "Remote port is invalid" }
      val suffix = "/v1/port-forwards/$remotePort"
      return when {
        syncEndpoint.endsWith("/v1/sync") -> syncEndpoint.removeSuffix("/v1/sync") + suffix
        else -> error("Server endpoint is invalid")
      }
    }

    internal fun portDiscoveryEndpoint(syncEndpoint: String): String {
      val httpEndpoint = when {
        syncEndpoint.startsWith("wss://") -> "https://${syncEndpoint.removePrefix("wss://")}"
        syncEndpoint.startsWith("ws://") -> "http://${syncEndpoint.removePrefix("ws://")}"
        else -> error("Server endpoint is invalid")
      }
      return when {
        httpEndpoint.endsWith("/v1/sync") -> httpEndpoint.removeSuffix("/v1/sync") + "/v1/port-forwards/discovery"
        else -> error("Server endpoint is invalid")
      }
    }

    private fun diagnostic(error: Throwable, fallback: String): String =
      error.message?.takeIf { it.isNotBlank() }?.take(240) ?: fallback

    private fun unavailableMessage(port: Int): String =
      "Nothing is listening on remote localhost:$port"

    private fun safeId(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(48)
  }
}
