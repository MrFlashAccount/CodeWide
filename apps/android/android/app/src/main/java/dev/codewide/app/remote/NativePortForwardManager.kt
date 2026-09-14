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
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
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
  val profile: CurrentPortForward,
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
    put(
      "previewUrl",
      if (localPort == null || status != "live") JSONObject.NULL
      else "http://127.0.0.1:$localPort/",
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
    val clientSlots: Semaphore = Semaphore(MAX_CLIENTS_PER_PROFILE, true),
    val clients: MutableSet<Socket> = ConcurrentHashMap.newKeySet(),
    val webSockets: MutableSet<WebSocket> = ConcurrentHashMap.newKeySet(),
    val closed: AtomicBoolean = AtomicBoolean(false),
  )

  private val store = NativePortForwardStore()
  // Invalid policy data must fail port discovery closed, not prevent the
  // shared connection service (and unrelated chat traffic) from starting.
  private val policies by lazy { NativePortForwardPolicyStore(context) }
  private val inventoryLock = Any()
  private val inventoryEpochs = ConcurrentHashMap<String, Long>()
  private val suspended = ConcurrentHashMap.newKeySet<String>()
  @Volatile private var closed = false
  private val inventorySnapshots = ConcurrentHashMap<String, String>()
  private val inventoryWorker = PortInventoryWorker(::applyInventory)
  private val runtimes = ConcurrentHashMap<String, Runtime>()
  private val projections = ConcurrentHashMap<String, PortForwardProjection>()
  private val availablePorts = ConcurrentHashMap<String, Map<Int, String>>()
  private val credentialCache = ConcurrentHashMap<String, CachedCredential>()
  private val credentialLocks = CredentialLockRegistry()
  private val startGate = PortForwardStartGate()
  private val inventoryReconciler = PortForwardInventoryReconciler(
    store, { connectionId, serviceKey, port -> policies.preference(connectionId, serviceKey, port) },
    { connectionId, entry, existing, preference ->
      upsertCurrent(connectionId, existing?.id ?: "forward-${java.util.UUID.randomUUID()}",
        entry.label, entry.port, existing?.preferredLocalPort, entry.serviceKey, preference).profile
    },
    runtimes::containsKey,
    { startCurrent(it) },
    ::removeCurrent,
  )
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
    credentialsStore.list().filter { it.enabled }.forEach { resumeConnection(it.id) }
  }

  fun list(connectionId: String): List<PortForwardProjection> = store.list(connectionId)
    .sortedWith(compareByDescending<CurrentPortForward> { it.enabled }.thenByDescending { it.updatedAt })
    .map { profile -> projections[profile.id] ?: PortForwardProjection(profile, null, if (profile.enabled) "connecting" else "stopped", null) }

  /** Reads the last pushed snapshot; never performs network discovery. */
  fun discover(connectionId: String): String = inventorySnapshots[connectionId]
    ?: "{\"ports\":[],\"scannedAt\":0}"

  fun receiveInventory(connectionId: String, payload: String) {
    if (closed || connectionId in suspended) return
    val generation = inventoryEpochs[connectionId] ?: 0L
    inventoryWorker.submit(PendingPortInventory(connectionId, generation, payload))
  }

  private fun applyInventory(pending: PendingPortInventory) {
    runCatching {
      require(SyncV2ContractGenerated.validateDefinitionJson("portsResponse", pending.payload)) {
        "Port inventory is invalid"
      }
      val envelope = JSONObject(pending.payload)
      val inventory = parsePortForwardInventory(envelope.getJSONArray("ports"))
      val discoveredByPort = inventory.associate { it.port to it.serviceKey }
      synchronized(inventoryLock) {
        if (closed || pending.serverId in suspended ||
          (inventoryEpochs[pending.serverId] ?: 0L) != pending.generation) return
        availablePorts[pending.serverId] = discoveredByPort
        inventoryReconciler.reconcile(pending.serverId, inventory)
        inventorySnapshots[pending.serverId] = pending.payload
      }
      CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "inventory")
        .put("connectionId", pending.serverId).toString())
    }.onFailure {
      // Wire data and native exceptions can contain user metadata. Emit only a bounded event.
      CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "inventoryError")
        .put("connectionId", pending.serverId).toString())
    }
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
    return synchronized(inventoryLock) {
      check(!closed && connectionId !in suspended) { "Port inventory is suspended" }
      val currentKey = availablePorts[connectionId]?.get(remotePort)
        ?: error("Port is not present in the current inventory")
      require(serviceKey == null || serviceKey == currentKey) { "Port service has changed" }
      val requested = store.get(profileId)
      require(requested == null || requested.connectionId == connectionId) { "Port forward belongs to another server" }
      // A scan may create the automatic forward before an explicit UI action
      // arrives. One discovered service owns exactly one phone listener.
      val currentId = store.list(connectionId).firstOrNull { it.serviceKey == currentKey }?.id ?: profileId
      upsertCurrent(connectionId, currentId, label, remotePort, preferredLocalPort, currentKey, preference, persistPreference = true)
    }
  }

  private fun upsertCurrent(
    connectionId: String,
    profileId: String,
    label: String,
    remotePort: Int,
    preferredLocalPort: Int?,
    serviceKey: String,
    preference: String,
    persistPreference: Boolean = false,
  ): PortForwardProjection {
    val previous = store.get(profileId)
    require(previous == null || previous.connectionId == connectionId) { "Port forward belongs to another server" }
    val nextIdentityMode = PortForwardIdentityMode.DISCOVERED
    require(portForwardIdentityTransitionAllowed(previous?.identityMode, nextIdentityMode)) {
      "A discovered port profile cannot be downgraded to manual"
    }
    val draft = CurrentPortForward(
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
      )
    NativePortForwardStore.validate(draft)
    if (persistPreference) policies.set(connectionId, serviceKey, remotePort, preference)
    val profile = store.upsert(draft)
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
        current?.status ?: "live",
        current?.error,
      ).also(::publish)
    }
    return PortForwardProjection(profile, null, "stopped", null).also(::publish)
  }

  fun start(profileId: String): PortForwardProjection {
    return synchronized(inventoryLock) { startCurrent(profileId) }
  }

  private fun startCurrent(profileId: String): PortForwardProjection {
    val selected = store.get(profileId) ?: error("Port forward not found")
    check(!closed && selected.connectionId !in suspended) { "Port inventory is suspended" }
    check(availablePorts[selected.connectionId]?.get(selected.remotePort) == selected.serviceKey) {
      "Port is not present in the current inventory"
    }
    if (selected.preference == "excluded") {
      policies.set(selected.connectionId, requireNotNull(selected.serviceKey), selected.remotePort, "included")
      store.upsert(selected.copy(preference = "included"))
    }
    runtimes[profileId]?.let { runtime ->
      return projections[profileId] ?: projection(
        store.get(profileId) ?: error("Port forward not found"),
        runtime.serverSocket.localPort,
        "live",
        null,
      )
    }
    val stored = store.get(profileId) ?: error("Port forward not found")
    if (stored.preference == "excluded") {
      return projection(stored, null, "stopped", null).also(::publish)
    }
    val permit = startGate.begin(profileId)
    var enabledProfile: CurrentPortForward? = null
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
        var runningProfile: CurrentPortForward? = null
        startGate.runIfCurrent(permit) {
          val current = store.get(profile.id)
          if (current?.enabled == true && current.preference != "excluded" && runtimes.putIfAbsent(profile.id, runtime) == null) {
            runningProfile = current
            val confirmedPorts = availablePorts[current.connectionId]
            val error = confirmedPorts?.let { portAvailabilityError(current, it) }
            val status = if (error == null) "live" else "unavailable"
            publish(projection(current, socket.localPort, status, error))
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
    return synchronized(inventoryLock) {
      val current = store.get(profileId) ?: error("Port forward not found")
      policies.set(current.connectionId, requireNotNull(current.serviceKey), current.remotePort, "excluded")
      store.upsert(current.copy(preference = "excluded"))
      stopCurrent(profileId)
    }
  }

  private fun stopCurrent(profileId: String): PortForwardProjection {
    stopRuntime(profileId, persistDisabled = true)
    val profile = store.get(profileId) ?: error("Port forward not found")
    return projection(profile, null, "stopped", null).also(::publish)
  }

  fun remove(profileId: String) {
    // Removing a visible forward is an explicit exclusion. Inventory eviction
    // uses removeCurrent instead and never erases the user's policy.
    stop(profileId)
  }

  private fun removeCurrent(profileId: String) {
    stopRuntime(profileId, persistDisabled = false)
    store.remove(profileId)
    projections.remove(profileId)
    CodeWideModule.emitPortForwardEvent(JSONObject().put("type", "removed").put("id", profileId).toString())
  }

  fun resumeConnection(connectionId: String) {
    synchronized(inventoryLock) { suspended.remove(connectionId) }
  }

  fun suspendConnection(connectionId: String) {
    synchronized(inventoryLock) {
      suspended.add(connectionId)
      inventoryEpochs[connectionId] = (inventoryEpochs[connectionId] ?: 0L) + 1
      store.list(connectionId).forEach { removeCurrent(it.id) }
      availablePorts.remove(connectionId)
      inventorySnapshots.remove(connectionId)
    }
    credentialCache.remove(connectionId)
  }

  fun removeConnection(connectionId: String) {
    suspendConnection(connectionId)
    policies.removeConnection(connectionId)
    credentialCache.remove(connectionId)
    credentialLocks.remove(connectionId)
    availablePorts.remove(connectionId)
  }

  fun close() {
    inventoryWorker.close()
    synchronized(inventoryLock) { closed = true }
    startGate.close()
    runtimes.keys.toList().forEach { stopRuntime(it, persistDisabled = false) }
    credentialCache.clear()
    credentialLocks.clear()
    bridgePool.shutdownNow()
  }

  private fun accept(profile: CurrentPortForward, runtime: Runtime) {
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

  private fun bridge(profile: CurrentPortForward, runtime: Runtime, client: Socket) {
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
          thread(name = "CodeWideForwardUpload-${safeId(profile.id)}", isDaemon = true) {
            try {
              copyPortForwardInput(client.getInputStream()) { buffer, count ->
                while (!closed.get() && socket.queueSize() > MAX_WEBSOCKET_QUEUE_BYTES) Thread.sleep(10)
                !closed.get() && socket.send(buffer.toByteString(0, count))
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
    profile: CurrentPortForward,
    localPort: Int?,
    status: String,
    error: String?,
  ): PortForwardProjection = PortForwardProjection(profile, localPort, status, error?.take(240))

  private fun runtimeProjection(
    profile: CurrentPortForward,
    runtime: Runtime,
    status: String,
    error: String?,
  ): PortForwardProjection = projection(
    profile,
    runtime.serverSocket.localPort,
    status,
    error,
  )

  private fun publishIfChanged(next: PortForwardProjection) {
    val previous = projections[next.profile.id]
    if (
      previous?.status == next.status && previous.error == next.error &&
      previous.localPort == next.localPort &&
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
    private const val MAX_WEBSOCKET_QUEUE_BYTES = 4L * 1024 * 1024
    private const val CREDENTIAL_TIMEOUT_MS = 20_000L
    private const val CREDENTIAL_EXPIRY_LEAD_MS = 30_000L
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

    private fun diagnostic(error: Throwable, fallback: String): String =
      error.message?.takeIf { it.isNotBlank() }?.take(240) ?: fallback

    private fun unavailableMessage(port: Int): String =
      "Nothing is listening on remote localhost:$port"

    internal fun portAvailabilityError(profile: CurrentPortForward, discovered: Map<Int, String>): String? {
      val currentKey = discovered[profile.remotePort] ?: return unavailableMessage(profile.remotePort)
      return if (
        profile.identityMode == PortForwardIdentityMode.DISCOVERED &&
        profile.serviceKey != currentKey
      ) {
        "The service listening on localhost:${profile.remotePort} has changed"
      } else null
    }

    private fun safeId(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(48)
  }
}

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
