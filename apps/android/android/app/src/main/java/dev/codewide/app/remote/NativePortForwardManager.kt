package dev.codewide.app.remote

import android.content.Context
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
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Semaphore
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

internal data class PortForwardProjection(
  val profile: StoredPortForward,
  val localPort: Int?,
  val status: String,
  val error: String?,
  val localCapability: String? = null,
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
    put(
      "previewUrl",
      if (localPort == null || localCapability == null || status != "live") JSONObject.NULL
      else "http://127.0.0.1:$localPort/$localCapability/",
    )
    put("error", error ?: JSONObject.NULL)
    put("updatedAt", profile.updatedAt)
  }
}

internal class PortForwardStartGate {
  internal data class Permit(val profileId: String, val generation: Long)

  private val lock = Any()
  private val generations = mutableMapOf<String, Long>()
  private var closed = false

  fun begin(profileId: String): Permit = synchronized(lock) {
    check(!closed) { "Port forwarding manager is closed" }
    val generation = Math.addExact(generations[profileId] ?: 0L, 1L)
    generations[profileId] = generation
    Permit(profileId, generation)
  }

  fun revoke(profileId: String, action: () -> Unit = {}) = synchronized(lock) {
    generations[profileId] = Math.addExact(generations[profileId] ?: 0L, 1L)
    action()
  }

  fun close() = synchronized(lock) {
    closed = true
  }

  fun isCurrent(permit: Permit): Boolean = synchronized(lock) {
    !closed && generations[permit.profileId] == permit.generation
  }

  fun runIfCurrent(permit: Permit, action: () -> Unit): Boolean = synchronized(lock) {
    if (closed || generations[permit.profileId] != permit.generation) return@synchronized false
    action()
    true
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
    val permit: PortForwardStartGate.Permit,
    val serverSocket: ServerSocket,
    val localCapability: String = randomLocalCapability(),
    val clientSlots: Semaphore = Semaphore(MAX_CLIENTS_PER_PROFILE, true),
    val clients: MutableSet<Socket> = ConcurrentHashMap.newKeySet(),
    val webSockets: MutableSet<WebSocket> = ConcurrentHashMap.newKeySet(),
    val closed: AtomicBoolean = AtomicBoolean(false),
  )

  private val store = NativePortForwardStore(context)
  private val runtimes = ConcurrentHashMap<String, Runtime>()
  private val projections = ConcurrentHashMap<String, PortForwardProjection>()
  private val availablePorts = ConcurrentHashMap<String, Map<Int, String>>()
  private val credentialCache = ConcurrentHashMap<String, CachedCredential>()
  private val credentialLocks = CredentialLockRegistry()
  private val startGate = PortForwardStartGate()
  private val bridgePool: ExecutorService = ThreadPoolExecutor(
    0,
    MAX_ACTIVE_CLIENTS,
    IDLE_WORKER_TIMEOUT_SECONDS,
    TimeUnit.SECONDS,
    SynchronousQueue(),
    { runnable -> Thread(runnable, "CodeWideForwardBridge").apply { isDaemon = true } },
    ThreadPoolExecutor.AbortPolicy(),
  )

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
    val nextIdentityMode = if (serviceKey == null) PortForwardIdentityMode.MANUAL else PortForwardIdentityMode.DISCOVERED
    require(portForwardIdentityTransitionAllowed(previous?.identityMode, nextIdentityMode)) {
      "A discovered port profile cannot be downgraded to manual"
    }
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
        identityMode = nextIdentityMode,
      ),
    )
    val wasRunning = runtimes.containsKey(profileId)
    val transportChanged = previous == null
      || previous.remotePort != profile.remotePort
      || previous.preferredLocalPort != profile.preferredLocalPort
      || previous.serviceKey != profile.serviceKey
    if (profile.preference == "excluded") {
      stopRuntime(profileId, persistDisabled = false)
      return projection(profile, null, "stopped", null).also(::publish)
    } else if (profile.enabled && transportChanged) {
      stopRuntime(profileId, persistDisabled = false)
      return start(profileId)
    } else if (wasRunning) {
      val current = projections[profileId]
      val runtime = runtimes[profileId] ?: error("Port forward runtime disappeared")
      return projection(
        profile,
        runtime.serverSocket.localPort,
        runtime.localCapability,
        current?.status ?: "live",
        current?.error,
      ).also(::publish)
    }
    return PortForwardProjection(profile, null, "stopped", null).also(::publish)
  }

  fun start(profileId: String): PortForwardProjection {
    runtimes[profileId]?.let { runtime ->
      return projections[profileId] ?: projection(
        store.get(profileId) ?: error("Port forward not found"),
        runtime.serverSocket.localPort,
        runtime.localCapability,
        "live",
        null,
      )
    }
    val stored = store.get(profileId) ?: error("Port forward not found")
    if (stored.preference == "excluded") {
      return projection(stored, null, "stopped", null).also(::publish)
    }
    val permit = startGate.begin(profileId)
    var enabledProfile: StoredPortForward? = null
    startGate.runIfCurrent(permit) {
      enabledProfile = store.setEnabled(profileId, true)
    }
    val profile = enabledProfile ?: error("Port forward start was revoked")
    val credentials = credentialsStore.get(profile.connectionId)
    if (credentials?.enabled != true) {
      return publishStartPhase(permit, "error", "Server connection is disabled")
    }
    val connecting = publishStartPhase(permit, "connecting", null)
    thread(name = "CodeWideForwardBind-${safeId(profile.id)}", isDaemon = true) {
      try {
        val socket = ServerSocket().apply {
          reuseAddress = true
          bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), profile.preferredLocalPort ?: 0), LISTENER_BACKLOG)
        }
        val runtime = Runtime(profile.id, permit, socket)
        var runningProfile: StoredPortForward? = null
        startGate.runIfCurrent(permit) {
          val current = store.get(profile.id)
          if (current?.enabled == true && current.preference != "excluded" && runtimes.putIfAbsent(profile.id, runtime) == null) {
            runningProfile = current
            val confirmedPorts = availablePorts[current.connectionId]
            val error = confirmedPorts?.let { portAvailabilityError(current, it) }
            val status = if (error == null) "live" else "unavailable"
            publish(projection(current, socket.localPort, runtime.localCapability, status, error))
          }
        }
        val acceptedProfile = runningProfile
        if (acceptedProfile == null) {
          socket.close()
          return@thread
        }
        accept(acceptedProfile, runtime)
      } catch (error: Throwable) {
        startGate.runIfCurrent(permit) {
          val current = store.get(profile.id)
          if (current?.enabled == true) {
            publish(projection(current, null, "error", diagnostic(error, "Could not open phone port")))
          }
        }
      }
    }
    return connecting
  }

  fun stop(profileId: String): PortForwardProjection {
    stopRuntime(profileId, persistDisabled = true)
    val profile = store.get(profileId) ?: error("Port forward not found")
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
    credentialLocks.remove(connectionId)
    availablePorts.remove(connectionId)
  }

  fun close() {
    startGate.close()
    runtimes.keys.toList().forEach { stopRuntime(it, persistDisabled = false) }
    credentialCache.clear()
    credentialLocks.clear()
    bridgePool.shutdownNow()
  }

  private fun accept(profile: StoredPortForward, runtime: Runtime) {
    while (!runtime.closed.get()) {
      val client = try {
        runtime.serverSocket.accept()
      } catch (_: IOException) {
        break
      }
      if (!client.inetAddress.isLoopbackAddress || !runtime.clientSlots.tryAcquire()) {
        client.close()
        continue
      }
      client.tcpNoDelay = true
      runtime.clients.add(client)
      try {
        bridgePool.execute {
          try {
            bridge(profile, runtime, client)
          } finally {
            runtime.clientSlots.release()
          }
        }
      } catch (_: Throwable) {
        runtime.clients.remove(client)
        runCatching { client.close() }
        runtime.clientSlots.release()
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
    val authorized = try {
      client.soTimeout = LOCAL_AUTH_TIMEOUT_MS
      PortForwardLocalAuthorization.authenticateBeforeUpstream(
        BufferedInputStream(client.getInputStream()),
        runtime.localCapability,
      ) { it }
    } catch (_: Throwable) {
      close()
      return
    }
    try {
      val saved = credentialsStore.get(profile.connectionId) ?: error("Saved server credentials are missing")
      require(saved.enabled) { "Server connection is disabled" }
      val credential = credential(saved)
      val request = Request.Builder()
        .url(InnerTlsTransport.url(saved, portForwardEndpoint(saved.endpoint, profile.remotePort)))
        .header("Authorization", "Bearer ${credential.token}")
        .header(FORWARDING_MODE_HEADER, profile.identityMode.wireValue)
        .apply { profile.serviceKey?.let { header(FORWARDING_KEY_HEADER, it) } }
        .build()
      val clientForServer = InnerTlsTransport.client(baseClient, saved)
      webSocket = clientForServer.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(socket: WebSocket, response: Response) {
          var accepted = false
          startGate.runIfCurrent(runtime.permit) {
            if (!runtime.closed.get()) {
              accepted = true
              runtime.webSockets.add(socket)
              publishIfChanged(runtimeProjection(store.get(profile.id) ?: profile, runtime, "live", null))
            }
          }
          if (!accepted) {
            socket.close(1000, "port_forward_start_revoked")
            close()
            return
          }
          client.soTimeout = 0
          if (authorized.initialPayload.isNotEmpty() && !socket.send(authorized.initialPayload.toByteString())) {
            close()
            return
          }
          thread(name = "CodeWideForwardUpload-${safeId(profile.id)}", isDaemon = true) {
            try {
              val input = authorized.input
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
          publishRuntimeIfCurrent(
            runtime,
            runtimeProjection(
              store.get(profile.id) ?: profile,
              runtime,
              "error",
              "Invalid text frame from server",
            ),
          )
          close()
        }

        override fun onClosed(socket: WebSocket, code: Int, reason: String) = close()

        override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
          if (response?.code == 401 || response?.code == 403) credentialCache.remove(profile.connectionId)
          publishRuntimeIfCurrent(
            runtime,
            runtimeProjection(
              store.get(profile.id) ?: profile,
              runtime,
              if (response?.code == 502) "unavailable" else "error",
              if (response?.code == 502) unavailableMessage(profile.remotePort)
              else diagnostic(error, "Port forward connection failed"),
            ),
          )
          close()
        }
      })
    } catch (error: Throwable) {
      publishRuntimeIfCurrent(
        runtime,
        runtimeProjection(
          store.get(profile.id) ?: profile,
          runtime,
          "error",
          diagnostic(error, "Port forward connection failed"),
        ),
      )
      close()
    }
  }

  private fun credential(saved: StoredNativeSession): MintedSessionCredential {
    credentialCache[saved.id]?.value?.takeIf { it.expiresAt - CREDENTIAL_EXPIRY_LEAD_MS > System.currentTimeMillis() }?.let { return it }
    val lock = credentialLocks.lockFor(saved.id)
    synchronized(lock) {
      credentialCache[saved.id]?.value?.takeIf { it.expiresAt - CREDENTIAL_EXPIRY_LEAD_MS > System.currentTimeMillis() }?.let { return it }
      val latch = CountDownLatch(1)
      var result: Result<MintedSessionCredential>? = null
      SessionCredentialClient.mint(baseClient, saved) {
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
      .url(InnerTlsTransport.url(saved, portDiscoveryEndpoint(saved.endpoint)))
      .header("Authorization", "Bearer ${credential.token}")
      .get()
      .build()
    val clientForServer = InnerTlsTransport.client(baseClient, saved).newBuilder()
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
      val discoveredByPort = buildMap {
        for (index in 0 until rows.length()) {
          val row = rows.getJSONObject(index)
          put(row.getInt("port"), row.getString("forwardingKey"))
        }
      }
      availablePorts[saved.id] = discoveredByPort
      reconcileAvailability(saved.id, discoveredByPort)
      return body
    }
  }

  private fun reconcileAvailability(connectionId: String, discovered: Map<Int, String>) {
    store.list(connectionId).filter { it.enabled }.forEach { profile ->
      val runtime = runtimes[profile.id] ?: return@forEach
      val error = portAvailabilityError(profile, discovered)
      val status = if (error == null) "live" else "unavailable"
      publishRuntimeIfCurrent(
        runtime,
        runtimeProjection(profile, runtime, status, error),
      )
    }
  }

  private fun stopRuntime(profileId: String, persistDisabled: Boolean) {
    startGate.revoke(profileId) {
      if (persistDisabled) store.setEnabled(profileId, false)
    }
    val runtime = runtimes.remove(profileId) ?: return
    runtime.closed.set(true)
    runCatching { runtime.serverSocket.close() }
    runtime.clients.toList().forEach { runCatching { it.close() } }
    runtime.webSockets.toList().forEach { it.close(1000, "port_forward_stopped") }
    runtime.clients.clear()
    runtime.webSockets.clear()
  }

  private fun projection(
    profile: StoredPortForward,
    localPort: Int?,
    status: String,
    error: String?,
  ): PortForwardProjection = PortForwardProjection(profile, localPort, status, error?.take(240))

  private fun projection(
    profile: StoredPortForward,
    localPort: Int?,
    localCapability: String?,
    status: String,
    error: String?,
  ): PortForwardProjection = PortForwardProjection(profile, localPort, status, error?.take(240), localCapability)

  private fun runtimeProjection(
    profile: StoredPortForward,
    runtime: Runtime,
    status: String,
    error: String?,
  ): PortForwardProjection = projection(
    profile,
    runtime.serverSocket.localPort,
    runtime.localCapability,
    status,
    error,
  )

  private fun publishIfChanged(next: PortForwardProjection) {
    val previous = projections[next.profile.id]
    if (
      previous?.status == next.status && previous.error == next.error &&
      previous.localPort == next.localPort && previous.localCapability == next.localCapability &&
      previous.profile == next.profile
    ) return
    publish(next)
  }

  private fun publishRuntimeIfCurrent(runtime: Runtime, next: PortForwardProjection) {
    startGate.runIfCurrent(runtime.permit) {
      if (!runtime.closed.get()) publishIfChanged(next)
    }
  }

  private fun publishStartPhase(
    permit: PortForwardStartGate.Permit,
    status: String,
    failure: String?,
  ): PortForwardProjection {
    var result: PortForwardProjection? = null
    startGate.runIfCurrent(permit) {
      val current = store.get(permit.profileId)
      if (current?.enabled == true && current.preference != "excluded") {
        result = projection(current, null, status, failure).also(::publish)
      }
    }
    return result ?: error("Port forward start was revoked")
  }

  private fun publish(next: PortForwardProjection) {
    projections[next.profile.id] = next
    CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "profile").put("profile", next.json()).toString())
  }

  companion object {
    private const val LISTENER_BACKLOG = 32
    private const val MAX_CLIENTS_PER_PROFILE = 64
    private const val MAX_ACTIVE_CLIENTS = 64
    private const val IDLE_WORKER_TIMEOUT_SECONDS = 30L
    private const val STREAM_CHUNK_BYTES = 64 * 1024
    private const val MAX_WEBSOCKET_QUEUE_BYTES = 4L * 1024 * 1024
    private const val CREDENTIAL_TIMEOUT_MS = 20_000L
    private const val CREDENTIAL_EXPIRY_LEAD_MS = 30_000L
    private const val DISCOVERY_TIMEOUT_MS = 10_000L
    private const val MAX_DISCOVERY_RESPONSE_CHARS = 256 * 1024
    private const val LOCAL_AUTH_TIMEOUT_MS = 5_000
    internal const val FORWARDING_KEY_HEADER = "X-CodeWide-Forwarding-Key"
    internal const val FORWARDING_MODE_HEADER = "X-CodeWide-Forwarding-Mode"

    internal fun portForwardEndpoint(syncEndpoint: String, remotePort: Int): String {
      require(remotePort in 1..65_535) { "Remote port is invalid" }
      val suffix = "/v2/ports/$remotePort"
      return when {
        syncEndpoint.endsWith("/v1/sync") -> syncEndpoint.removeSuffix("/v1/sync") + suffix
        syncEndpoint.endsWith("/v2/sync") -> syncEndpoint.removeSuffix("/v2/sync") + suffix
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
        httpEndpoint.endsWith("/v1/sync") -> httpEndpoint.removeSuffix("/v1/sync") + "/v2/ports"
        httpEndpoint.endsWith("/v2/sync") -> httpEndpoint.removeSuffix("/v2/sync") + "/v2/ports"
        else -> error("Server endpoint is invalid")
      }
    }

    private fun diagnostic(error: Throwable, fallback: String): String =
      error.message?.takeIf { it.isNotBlank() }?.take(240) ?: fallback

    private fun unavailableMessage(port: Int): String =
      "Nothing is listening on remote localhost:$port"

    internal fun portAvailabilityError(profile: StoredPortForward, discovered: Map<Int, String>): String? {
      val currentKey = discovered[profile.remotePort] ?: return unavailableMessage(profile.remotePort)
      return if (
        profile.identityMode == PortForwardIdentityMode.DISCOVERED &&
        profile.serviceKey != currentKey
      ) {
        "The service listening on localhost:${profile.remotePort} has changed"
      } else null
    }

    private fun randomLocalCapability(): String {
      val bytes = ByteArray(32)
      SecureRandom().nextBytes(bytes)
      return android.util.Base64.encodeToString(
        bytes,
        android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
      )
    }

    private fun safeId(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(48)
  }
}

internal data class AuthorizedPortForwardClient(
  val input: BufferedInputStream,
  val initialPayload: ByteArray,
)

internal class CredentialLockRegistry {
  private val locks = ConcurrentHashMap<String, Any>()

  fun lockFor(key: String): Any = locks.getOrPut(key) { Any() }

  fun remove(key: String) {
    locks.remove(key)
  }

  fun clear() {
    locks.clear()
  }

  fun size(): Int = locks.size
}

/** Authenticates a local caller before credentials or an upstream socket are touched. */
internal object PortForwardLocalAuthorization {
  private val CAPABILITY_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
  private val HTTP_VERSION_PATTERN = Regex("^HTTP/1\\.[01]$")
  private const val PREFACE_PREFIX = "CODEWIDE/1 "
  private const val CAPABILITY_HEADER = "x-codewide-local-capability"
  private const val MAX_FIRST_LINE_BYTES = 8 * 1024
  private const val MAX_HEADER_BYTES = 64 * 1024

  fun <T> authenticateBeforeUpstream(
    input: BufferedInputStream,
    capability: String,
    openUpstream: (AuthorizedPortForwardClient) -> T,
  ): T = openUpstream(authenticate(input, capability))

  fun authenticate(input: BufferedInputStream, capability: String): AuthorizedPortForwardClient {
    require(CAPABILITY_PATTERN.matches(capability)) { "Local capability is invalid" }
    val firstLine = readLine(input, MAX_FIRST_LINE_BYTES)
    val firstLineText = firstLine.toString(StandardCharsets.ISO_8859_1).removeSuffix("\r\n")
    if (firstLineText == "$PREFACE_PREFIX$capability") {
      return AuthorizedPortForwardClient(input, ByteArray(0))
    }
    val parts = firstLineText.split(' ', limit = 3)
    check(parts.size == 3 && HTTP_VERSION_PATTERN.matches(parts[2])) { "Local port client is unauthorized" }
    val headerTail = readHeaderTail(input, firstLine.size)
    val fields = headerTail.toString(StandardCharsets.ISO_8859_1)
      .removeSuffix("\r\n\r\n")
      .split("\r\n")
      .filter(String::isNotEmpty)
    val headerCapabilities = fields.mapNotNull { line ->
      val separator = line.indexOf(':')
      if (separator <= 0 || !line.substring(0, separator).equals(CAPABILITY_HEADER, ignoreCase = true)) null
      else line.substring(separator + 1).trim()
    }
    check(headerCapabilities.size <= 1) { "Local port client capability is ambiguous" }
    val pathPrefix = "/$capability"
    val pathAuthorized = parts[1].startsWith("$pathPrefix/")
    val headerCapability = headerCapabilities.singleOrNull()
    check(headerCapability == null || headerCapability == capability) { "Local port client is unauthorized" }
    val headerAuthorized = headerCapability == capability
    check(pathAuthorized || headerAuthorized) { "Local port client is unauthorized" }
    val target = if (pathAuthorized) parts[1].removePrefix(pathPrefix) else parts[1]
    val retained = fields.filterNot { line ->
      val separator = line.indexOf(':')
      separator > 0 && line.substring(0, separator).equals(CAPABILITY_HEADER, ignoreCase = true)
    }
    val sanitized = buildString {
      append(parts[0]).append(' ').append(target).append(' ').append(parts[2]).append("\r\n")
      retained.forEach { append(it).append("\r\n") }
      append("\r\n")
    }.toByteArray(StandardCharsets.ISO_8859_1)
    return AuthorizedPortForwardClient(input, sanitized)
  }

  private fun readLine(input: BufferedInputStream, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream()
    var previous = -1
    while (output.size() < maximum) {
      val value = input.read()
      check(value >= 0) { "Local port client disconnected during authorization" }
      output.write(value)
      if (previous == '\r'.code && value == '\n'.code) return output.toByteArray()
      previous = value
    }
    error("Local port authorization line is too large")
  }

  private fun readHeaderTail(input: BufferedInputStream, consumed: Int): ByteArray {
    val output = ByteArrayOutputStream()
    var tail = 0x0d0a
    while (consumed + output.size() < MAX_HEADER_BYTES) {
      val value = input.read()
      check(value >= 0) { "Local HTTP client disconnected during authorization" }
      output.write(value)
      tail = ((tail shl 8) or value) and 0xffffffff.toInt()
      if (tail == 0x0d0a0d0a) return output.toByteArray()
    }
    error("Local HTTP authorization headers are too large")
  }
}
