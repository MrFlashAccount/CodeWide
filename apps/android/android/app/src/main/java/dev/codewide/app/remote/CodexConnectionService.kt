package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import dev.codewide.app.MainActivity
import dev.codewide.app.R
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class CodexConnectionService : Service() {
  private data class HeadlessV2Subscription(val handle: String, val channelId: String)

  private lateinit var frameStore: NativeFrameStore
  private lateinit var commandStore: NativeCommandStore
  private lateinit var credentialsStore: NativeSessionCredentialsStore
  private lateinit var portForwardManager: NativePortForwardManager
  private lateinit var terminalSessionManager: NativeTerminalSessionManager
  private lateinit var companionHttpProxy: NativeCompanionHttpProxy
  private lateinit var authenticatedTransportLeases: AuthenticatedTransportLeaseRegistry
  private lateinit var syncGenerationStore: NativeSyncGenerationStore
  private lateinit var v2NotificationProjectionStore: V2NotificationProjectionStore
  private lateinit var processExitTelemetry: NativeProcessExitTelemetry
  private lateinit var connectivityManager: ConnectivityManager
  private val handler = Handler(Looper.getMainLooper())
  private val recoveryWorker = NativeRecoveryWorker()
  private val journalThread = HandlerThread("CodeWideJournal")
  private lateinit var journalHandler: Handler
  private val sessions = ConcurrentHashMap<String, Session>()
  private val authenticatedLeaseServers = ConcurrentHashMap<String, String>()
  private val foregroundV2SyncChannels = V2ForegroundSyncChannels()
  private val v2NotificationProjections = ConcurrentHashMap<String, V2NotificationProjection>()
  private val headlessV2Subscriptions = ConcurrentHashMap<String, HeadlessV2Subscription>()
  private val headlessV2ReconnectPolicy = V2HeadlessReconnectPolicy()
  private val headlessV2FairScheduler = V2HeadlessFairScheduler(MAX_HEADLESS_V2_SUBSCRIPTIONS)
  private val v2AuthenticatedLeaseAdmission by lazy(LazyThreadSafetyMode.NONE) {
    V2AuthenticatedLeaseAdmission(
      headlessV2FairScheduler,
      acquire = authenticatedTransportLeases::acquire,
      stopHeadless = ::stopHeadlessV2,
      scheduleFairness = ::scheduleHeadlessV2Fairness,
    )
  }
  private var headlessV2FairnessScheduled = false
  private val headlessV2FairnessRunnable = Runnable {
    synchronized(this) {
      headlessV2FairnessScheduled = false
      runHeadlessV2FairnessCycle()
    }
  }
  @Volatile private var syncGeneration = NativeSyncGeneration.LEGACY
  @Volatile private var destroyed = false
  @Volatile private var activeDefaultNetwork: Network? = null
  private var processExitTelemetryCollectionStarted = false
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) {
      synchronized(this@CodexConnectionService) {
        activeDefaultNetwork = network
        sessions.values.forEach { it.reconnectNow() }
        if (syncGeneration == NativeSyncGeneration.V2) {
          headlessV2ReconnectPolicy.resetAll()
          restoreHeadlessV2()
        }
      }
    }

    override fun onLost(network: Network) {
      synchronized(this@CodexConnectionService) {
        // During Wi-Fi/cellular handoff Android may report onAvailable(new)
        // before onLost(old). The stale loss must not tear down the new socket.
        if (activeDefaultNetwork != network) return
        activeDefaultNetwork = null
        sessions.values.forEach { it.networkLost() }
        if (syncGeneration == NativeSyncGeneration.V2) {
          stopAllHeadlessV2()
          updateNotification()
        }
      }
    }
  }
  private val httpClient = OkHttpClient.Builder()
    .pingInterval(25, TimeUnit.SECONDS)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .retryOnConnectionFailure(true)
    .build()
  // WebSockets intentionally have no read timeout. Session challenge/mint is
  // ordinary HTTP and must never inherit that infinite wait.
  private val credentialHttpClient = httpClient.newBuilder()
    .callTimeout(CREDENTIAL_HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .connectTimeout(CREDENTIAL_HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .readTimeout(CREDENTIAL_HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .writeTimeout(CREDENTIAL_HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .build()

  override fun onCreate() {
    super.onCreate()
    journalThread.start()
    journalHandler = Handler(journalThread.looper)
    processExitTelemetry = NativeProcessExitTelemetry(this)
    frameStore = NativeFrameStore(this)
    commandStore = NativeCommandStore(this)
    credentialsStore = NativeSessionCredentialsStore(this)
    portForwardManager = NativePortForwardManager(this, credentialsStore, httpClient)
    terminalSessionManager = NativeTerminalSessionManager(credentialsStore, credentialHttpClient, httpClient, cacheDir)
    companionHttpProxy = NativeCompanionHttpProxy(credentialsStore)
    authenticatedTransportLeases = AuthenticatedTransportLeaseRegistry(
      credentialsStore,
      credentialHttpClient,
      httpClient,
      CodeWideModule::emitAuthenticatedTransportEvent,
    )
    syncGenerationStore = NativeSyncGenerationStore(this)
    syncGeneration = syncGenerationStore.read()
    if (syncGeneration == NativeSyncGeneration.V2) terminalSessionManager.deactivateGeneration()
    v2NotificationProjectionStore = V2NotificationProjectionStore(this)
    connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    activeDefaultNetwork = connectivityManager.activeNetwork
    createNotificationChannel()
    createActivityNotificationChannel()
    startForeground(NOTIFICATION_ID, notification())
    connectivityManager.registerDefaultNetworkCallback(networkCallback)
    processNativeAuthorityLifecycle.access {
      portForwardManager.restore()
      // Publish only a fully initialized service. Credential replacement uses
      // the same process lock, so restore cannot race a store-only replacement.
      instance = this
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_ATTACH -> {
        intent.getStringExtra(EXTRA_CONNECTION_ID)?.let { id ->
          recoverInBackground(id, "attach") {
            selectLegacySync()
            attach(id)
          }
        }
      }
      ACTION_CLOSE -> intent.getStringExtra(EXTRA_CONNECTION_ID)?.let(::close)
      ACTION_WAKE -> {
        intent.getStringExtra(EXTRA_CONNECTION_ID)?.let(::wake)
      }
      ACTION_ACTIVATE_V2 -> activateV2Sync(headless = false)
      ACTION_STOP_ALL -> stopSelf()
      null -> recoveryWorker.submit {
        synchronized(this) {
          if (!destroyed) restoreSelectedSyncGeneration()
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    processNativeAuthorityLifecycle.access {
      synchronized(this) {
        destroyed = true
        recoveryWorker.close()
        handler.removeCallbacksAndMessages(null)
        sessions.values.forEach { it.close("service_destroyed") }
        sessions.clear()
        portForwardManager.close()
        terminalSessionManager.destroy()
        authenticatedTransportLeases.shutdown()
        headlessV2Subscriptions.clear()
        companionHttpProxy.close()
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        activeDefaultNetwork = null
        httpClient.dispatcher.executorService.shutdown()
        if (instance === this) instance = null
        commandStore.close()
        journalThread.quitSafely()
      }
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  @Synchronized
  fun open(id: String, endpoint: String, token: String, tlsPinSha256: String) {
    val existing = sessions[id]
    if (existing != null && existing.endpoint == endpoint && existing.token == token && existing.tlsPinSha256 == tlsPinSha256) {
      // Attaching a recreated React runtime must not cancel the service-owned
      // socket. Replay the latest protocol checkpoint and durable event tail so
      // the new SyncSession can resume immediately on the existing transport.
      existing.attachRuntime()
      return
    }
    existing?.close("connection_replaced")
    val session = Session(id, endpoint, token, tlsPinSha256)
    sessions[id] = session
    session.replayBuffered()
    handler.post { if (!destroyed) session.connect() }
    portForwardManager.resumeConnection(id)
    updateNotification()
  }

  @Synchronized
  fun companionHttpOrigin(connectionId: String): String = companionHttpProxy.origin(connectionId)

  @Synchronized
  internal fun publishStartupTiming(timing: NativeStartupTiming) {
    sessions.values.forEach { it.publishStartupTiming(timing) }
  }

  @Synchronized
  internal fun acquireAuthenticatedTransportLease(savedServerId: String): String {
    val handle = if (syncGeneration == NativeSyncGeneration.V2) {
      v2AuthenticatedLeaseAdmission.acquire(savedServerId)
    } else {
      authenticatedTransportLeases.acquire(savedServerId)
    }
    authenticatedLeaseServers[handle] = savedServerId
    return handle
  }

  @Synchronized
  internal fun openAuthenticatedDuplex(handle: String, channelId: String, purpose: String) {
    if (purpose != "sync-v2") {
      authenticatedTransportLeases.openDuplex(handle, channelId, purpose)
      return
    }
    val savedServerId = authenticatedLeaseServers[handle]
      ?: error("Authenticated lease server is unavailable")
    stopHeadlessV2(savedServerId)
    admitNextWaitingHeadlessV2()
    val channel = V2ForegroundSyncChannel(handle, channelId)
    foregroundV2SyncChannels.replace(savedServerId, channel)?.let { previous ->
      authenticatedTransportLeases.closeChannel(
        previous.handle,
        previous.channelId,
        1000,
        "sync_v2_runtime_handoff",
      )
    }
    try {
      authenticatedTransportLeases.openDuplex(handle, channelId, purpose) { event ->
        when (event.type) {
          "message" -> event.data?.let { observeV2NotificationState(savedServerId, it) }
          "close", "error" -> {
            val retiredServer = foregroundV2SyncChannels.remove(channel)
            updateNotification()
            if (retiredServer != null) ensureHeadlessV2(retiredServer)
          }
        }
      }
    } catch (error: Throwable) {
      val retiredServer = foregroundV2SyncChannels.remove(channel)
      if (retiredServer != null) ensureHeadlessV2(retiredServer)
      throw error
    }
    updateNotification()
  }

  @Synchronized
  internal fun openAuthenticatedDuplex(
    handle: String,
    channelId: String,
    purpose: String,
    observer: (AuthenticatedDuplexEvent) -> Unit,
  ) = authenticatedTransportLeases.openDuplex(handle, channelId, purpose, observer)

  internal fun sendAuthenticatedDuplex(handle: String, channelId: String, data: String) =
    authenticatedTransportLeases.send(handle, channelId, data)

  @Synchronized
  internal fun closeAuthenticatedDuplex(handle: String, channelId: String, code: Int, reason: String) {
    val savedServerId = foregroundV2SyncChannels.remove(V2ForegroundSyncChannel(handle, channelId))
    authenticatedTransportLeases.closeChannel(handle, channelId, code, reason)
    updateNotification()
    if (savedServerId != null) ensureHeadlessV2(savedServerId)
  }

  @Synchronized
  internal fun authenticatedRequest(handle: String, purpose: String, input: String, completion: (Result<String>) -> Unit) =
    authenticatedTransportLeases.request(handle, purpose, input, completion)

  @Synchronized
  internal fun releaseAuthenticatedTransportLease(handle: String) {
    val savedServerId = authenticatedLeaseServers.remove(handle)
    val foregroundServers = foregroundV2SyncChannels.removeHandle(handle)
    authenticatedTransportLeases.release(handle)
    updateNotification()
    if (savedServerId != null) ensureHeadlessV2(savedServerId)
    foregroundServers.filterNot { it == savedServerId }.forEach(::ensureHeadlessV2)
    if (headlessV2FairScheduler.hasWaiting()) runHeadlessV2FairnessCycle()
  }

  @Synchronized
  internal fun activateV2Sync(headless: Boolean) {
    if (syncGeneration != NativeSyncGeneration.V2) {
      terminalSessionManager.deactivateGeneration()
      clearAllV2NotificationState()
      syncGeneration = NativeSyncGeneration.V2
      if (!syncGenerationStore.write(syncGeneration)) Log.w(LOG_TAG, "Could not persist V2 sync generation")
    }
    sessions.values.forEach { it.close("v2_generation_selected") }
    sessions.clear()
    if (headless) restoreHeadlessV2()
    updateNotification()
  }

  fun acknowledgeThrough(connectionId: String, projectionCursor: Long) {
    journalHandler.post { frameStore.acknowledgeThrough(connectionId, projectionCursor) }
  }

  internal fun readCommittedFrames(
    connectionId: String,
    afterCursor: Long?,
    maxFrames: Int,
    maxBytes: Int,
    completion: (Result<CommittedFramePage>) -> Unit,
  ) {
    journalHandler.post {
      completion(runCatching { frameStore.committedFrames(connectionId, afterCursor, maxFrames, maxBytes) })
    }
  }

  internal fun stopLegacyRuntimeResources() {
    terminalSessionManager.deactivateGeneration()
  }

  internal fun listPortForwards(connectionId: String): List<PortForwardProjection> = portForwardManager.list(connectionId)

  @Synchronized
  internal fun discoverPorts(connectionId: String): String = portForwardManager.discover(connectionId)

  @Synchronized
  internal fun upsertPortForward(
    connectionId: String,
    profileId: String,
    label: String,
    remotePort: Int,
    preferredLocalPort: Int?,
    serviceKey: String?,
    preference: String,
  ): PortForwardProjection = portForwardManager.upsert(
    connectionId,
    profileId,
    label,
    remotePort,
    preferredLocalPort,
    serviceKey,
    preference,
  )

  @Synchronized
  internal fun startPortForward(profileId: String): PortForwardProjection = portForwardManager.start(profileId)

  internal fun stopPortForward(profileId: String): PortForwardProjection = portForwardManager.stop(profileId)

  fun removePortForward(profileId: String) = portForwardManager.remove(profileId)

  @Synchronized
  internal fun openTerminal(sessionId: String, connectionId: String, threadId: String, cwd: String?, cols: Int, rows: Int) =
    terminalSessionManager.open(sessionId, connectionId, threadId, cwd, cols, rows)

  internal fun writeTerminal(sessionId: String, base64: String) = terminalSessionManager.write(sessionId, base64)

  internal fun resizeTerminal(sessionId: String, cols: Int, rows: Int) = terminalSessionManager.resize(sessionId, cols, rows)

  internal fun readTerminalOutput(sessionId: String, offset: Long, maxBytes: Int): String =
    terminalSessionManager.readOutput(sessionId, offset, maxBytes)

  internal fun closeTerminal(sessionId: String) = terminalSessionManager.close(sessionId)

  private fun attach(connectionId: String) {
    val saved = readRecoveryCredentials(connectionId)
    if (saved == null) {
      CodeWideModule.emitEngineEvent(
        connectionId,
        "state",
        JSONObject().put("state", "authRequired").put("rpcAvailable", false).put("error", "Saved native credentials are missing").toString(),
        null,
      )
      return
    }
    if (!saved.enabled) {
      CodeWideModule.emitEngineEvent(
        connectionId,
        "state",
        JSONObject().put("state", "offline").put("rpcAvailable", false).toString(),
        null,
      )
      return
    }
    val existing = sessions[connectionId]
    if (
      existing != null
      && existing.endpoint == saved.endpoint
      && existing.token == saved.token
      && existing.tlsPinSha256 == saved.innerTlsPinSha256
    ) {
      existing.attachRuntime()
      collectPreviousProcessExit(existing)
      return
    }
    open(saved.id, saved.endpoint, saved.token, saved.innerTlsPinSha256)
    sessions[connectionId]?.let(::collectPreviousProcessExit)
  }

  private fun collectPreviousProcessExit(session: Session) {
    if (processExitTelemetryCollectionStarted) return
    processExitTelemetryCollectionStarted = true
    journalHandler.post {
      val batch = runCatching { processExitTelemetry.collect() }.getOrNull() ?: return@post
      handler.post {
        synchronized(this@CodexConnectionService) {
          if (destroyed) return@synchronized
          if (sessions[session.id] !== session) {
            processExitTelemetryCollectionStarted = false
            return@synchronized
          }
          batch.metrics.forEach(session::publishProcessExitTelemetry)
          journalHandler.post { processExitTelemetry.acknowledge(batch.checkpointTimestampUnixMs) }
        }
      }
    }
  }

  fun rpc(connectionId: String, method: String, params: Any?, completion: (Result<Any?>) -> Unit) {
    val session = sessions[connectionId]
    if (session == null) completion(Result.failure(IllegalStateException("Connection is not enabled")))
    else session.rpc(method, params, completion)
  }

  internal fun enqueueCommand(
    connectionId: String,
    commandId: String,
    method: String,
    paramsJson: String,
  ): NativeCommand {
    val command = commandStore.enqueue(connectionId, commandId, method, paramsJson)
    CodeWideModule.emitEngineEvent(connectionId, "outbox", commandStore.stateJson(command), null)
    sessions[connectionId]?.drainOutbox()
    return command
  }

  internal fun listCommands(): List<NativeCommand> = commandStore.list()

  internal fun retryCommand(connectionId: String, commandId: String): NativeCommand {
    val command = commandStore.retryFailed(connectionId, commandId)
    CodeWideModule.emitEngineEvent(connectionId, "outbox", commandStore.stateJson(command), null)
    sessions[connectionId]?.drainOutbox()
    return command
  }

  internal fun acknowledgeCommandReceipt(connectionId: String, commandId: String) {
    commandStore.acknowledgeDeliveryReceipt(connectionId, commandId)
  }

  fun reset(connectionId: String, reason: String) {
    sessions[connectionId]?.resetTransport(reason)
  }

  fun wake(connectionId: String) {
    recoverInBackground(connectionId, "wake") {
      selectLegacySync()
      wakeRecovered(connectionId)
    }
  }

  private fun wakeRecovered(connectionId: String) {
    val saved = readRecoveryCredentials(connectionId)
    if (saved?.enabled != true) {
      attach(connectionId)
      return
    }
    val session = sessions[connectionId]
    if (
      session == null
      || session.endpoint != saved.endpoint
      || session.token != saved.token
      || session.tlsPinSha256 != saved.innerTlsPinSha256
    ) {
      attach(connectionId)
      return
    }
    handler.post { if (!destroyed) session.reconnectNow() }
  }

  private fun readRecoveryCredentials(connectionId: String): StoredNativeSession? {
    val startedAt = SystemClock.elapsedRealtimeNanos()
    return try {
      credentialsStore.get(connectionId)
    } finally {
      CodeWideModule.emitEngineEvent(connectionId, "telemetry", NativeTelemetryMetric(
        "connection.recovery_credentials",
        values = mapOf("durationMs" to elapsedMilliseconds(startedAt)),
      ).toJson(), null)
    }
  }

  private fun recoverInBackground(connectionId: String, action: String, operation: () -> Unit) {
    val queuedAt = SystemClock.elapsedRealtimeNanos()
    recoveryWorker.submit {
      val startedAt = SystemClock.elapsedRealtimeNanos()
      var outcome = "completed"
      var failureKind = "none"
      var lockWaitMs = 0.0
      try {
        synchronized(this) {
          if (destroyed) return@submit
          lockWaitMs = elapsedMilliseconds(startedAt)
          operation()
        }
      } catch (error: Exception) {
        outcome = "failed"
        failureKind = error.javaClass.simpleName
        // Recovery errors may contain credentials; only the bounded class is exported.
        CodeWideModule.emitEngineEvent(connectionId, "state", JSONObject()
          .put("state", "degraded").put("rpcAvailable", false)
          .put("error", "Native connection recovery failed ($failureKind)").toString(), null)
      } finally {
        CodeWideModule.emitEngineEvent(connectionId, "telemetry", NativeTelemetryMetric(
          "connection.recovery",
          values = mapOf(
            "queueWaitMs" to (startedAt - queuedAt) / 1_000_000.0,
            "durationMs" to elapsedMilliseconds(startedAt),
            "lockWaitMs" to lockWaitMs,
          ),
          tags = mapOf("action" to action, "outcome" to outcome, "failureKind" to failureKind),
        ).toJson(), null)
      }
    }
  }

  @Synchronized
  fun close(connectionId: String) {
    closeAuthenticatedServer(connectionId)
    clearV2NotificationState(connectionId)
    sessions.remove(connectionId)?.close("connection_disabled")
    credentialsStore.remove(connectionId)
    DeviceKeyStore.delete(connectionId)
    frameStore.deleteConnection(connectionId)
    commandStore.deleteConnection(connectionId)
    portForwardManager.removeConnection(connectionId)
    terminalSessionManager.closeConnection(connectionId)
    companionHttpProxy.remove(connectionId)
    updateNotification()
  }

  @Synchronized
  fun suspend(connectionId: String) {
    closeAuthenticatedServer(connectionId)
    sessions.remove(connectionId)?.close("connection_disabled")
    portForwardManager.suspendConnection(connectionId)
    terminalSessionManager.closeConnection(connectionId)
    companionHttpProxy.remove(connectionId)
    updateNotification()
  }

  /**
   * Replaces credentials only after every capability derived from the old authority is closed.
   * The service monitor also excludes concurrent lease, proxy, port and terminal creation.
   */
  @Synchronized
  internal fun replaceSavedServerAuthority(replacement: StoredNativeSession) {
    replaceNativeAuthority(
      revoke = { revokeSavedServerAuthority(replacement.id) },
      persist = { credentialsStore.upsert(replacement) },
      resume = { resumeSavedServerAuthority(replacement) },
    )
  }

  private fun revokeSavedServerAuthority(savedServerId: String) {
    revokeNativeAuthority(
      NativeAuthorityRevocation(
        authenticatedTransports = { closeAuthenticatedServer(savedServerId) },
        notificationProjection = { clearV2NotificationState(savedServerId) },
        legacySession = { sessions.remove(savedServerId)?.close("authority_replaced") },
        portForwards = { portForwardManager.suspendConnection(savedServerId) },
        terminalSessions = { terminalSessionManager.closeConnection(savedServerId) },
        httpProxy = { companionHttpProxy.remove(savedServerId) },
      ),
    )
    updateNotification()
  }

  private fun resumeSavedServerAuthority(replacement: StoredNativeSession) {
    if (!replacement.enabled || destroyed) return
    if (syncGeneration == NativeSyncGeneration.V2) {
      portForwardManager.resumeConnection(replacement.id)
      ensureHeadlessV2(replacement.id)
    } else attach(replacement.id)
  }

  private fun closeAuthenticatedServer(savedServerId: String) {
    stopHeadlessV2(savedServerId)
    foregroundV2SyncChannels.removeServer(savedServerId)
    val handles = authenticatedLeaseServers.entries
      .filter { it.value == savedServerId }
      .map { it.key }
    for (handle in handles) authenticatedLeaseServers.remove(handle)
    authenticatedTransportLeases.closeSavedServer(savedServerId)
    admitNextWaitingHeadlessV2()
  }

  @Synchronized
  internal fun activateLegacySync() {
    selectLegacySync()
    restoreLegacySync()
    updateNotification()
  }

  private fun selectLegacySync() {
    if (syncGeneration != NativeSyncGeneration.LEGACY) {
      syncGeneration = NativeSyncGeneration.LEGACY
      if (!syncGenerationStore.write(syncGeneration)) Log.w(LOG_TAG, "Could not persist legacy sync generation")
      stopAllHeadlessV2()
      authenticatedTransportLeases.closeAll()
      authenticatedLeaseServers.clear()
      foregroundV2SyncChannels.clear()
      clearAllV2NotificationState()
    }
    terminalSessionManager.activateGeneration()
  }

  private fun restoreSelectedSyncGeneration() {
    if (syncGeneration == NativeSyncGeneration.V2) activateV2Sync(headless = true)
    else activateLegacySync()
  }

  private fun restoreLegacySync() {
    credentialsStore.list().filter { it.enabled }.forEach { saved ->
      open(saved.id, saved.endpoint, saved.token, saved.innerTlsPinSha256)
    }
  }

  private fun restoreHeadlessV2() {
    credentialsStore.list().filter { it.enabled }.forEach { ensureHeadlessV2(it.id) }
  }

  @Synchronized
  private fun ensureHeadlessV2(savedServerId: String) {
    if (destroyed) return
    if (syncGeneration != NativeSyncGeneration.V2) return
    if (activeDefaultNetwork == null) return
    if (headlessV2Subscriptions.containsKey(savedServerId)) {
      headlessV2FairScheduler.admitted(savedServerId)
      return
    }
    if (foregroundV2SyncChannels.hasServer(savedServerId)) {
      headlessV2FairScheduler.remove(savedServerId)
      return
    }
    val saved = credentialsStore.get(savedServerId)
    if (saved?.enabled != true) {
      headlessV2FairScheduler.remove(savedServerId)
      return
    }
    headlessV2FairScheduler.enqueue(savedServerId)
    if (!headlessV2FairScheduler.canAdmit()) {
      scheduleHeadlessV2Fairness()
      return
    }
    val handle = runCatching { authenticatedTransportLeases.acquire(savedServerId) }.getOrNull()
    if (handle == null) {
      headlessV2FairScheduler.markCapacityBlocked()
      scheduleHeadlessV2Fairness()
      return
    }
    val channelId = UUID.randomUUID().toString()
    val subscription = HeadlessV2Subscription(handle, channelId)
    if (headlessV2Subscriptions.putIfAbsent(savedServerId, subscription) != null) {
      authenticatedTransportLeases.release(handle)
      headlessV2FairScheduler.admitted(savedServerId)
      admitNextWaitingHeadlessV2()
      return
    }
    headlessV2FairScheduler.admitted(savedServerId)
    runCatching {
      authenticatedTransportLeases.openDuplex(handle, channelId, "sync-v2") { event ->
        observeHeadlessV2(savedServerId, subscription, event)
      }
    }.onFailure {
      retireHeadlessV2(savedServerId, subscription, reconnect = true)
    }
    updateNotification()
  }

  private fun observeHeadlessV2(
    savedServerId: String,
    subscription: HeadlessV2Subscription,
    event: AuthenticatedDuplexEvent,
  ) {
    if (headlessV2Subscriptions[savedServerId] !== subscription) return
    when (event.type) {
      "open" -> {
        if (!sendHeadlessV2(subscription, headlessV2OpenFrame())) {
          retireHeadlessV2(savedServerId, subscription, reconnect = true)
        }
      }
      "message" -> event.data?.let { observeHeadlessV2Frame(savedServerId, subscription, it) }
      "close", "error" -> retireHeadlessV2(savedServerId, subscription, reconnect = true)
    }
  }

  private fun observeHeadlessV2Frame(
    savedServerId: String,
    subscription: HeadlessV2Subscription,
    text: String,
  ) {
    val frame = runCatching { SyncV2ContractGenerated.parseServerFrame(text) }.getOrElse {
      retireHeadlessV2(savedServerId, subscription, reconnect = true)
      return
    }
    observeV2NotificationState(savedServerId, text)
    when (frame.getString("type")) {
      "snapshot" -> {
        headlessV2ReconnectPolicy.reset(savedServerId)
        if (!sendHeadlessV2(
          subscription,
          JSONObject()
            .put("type", "snapshotCommitted")
            .put("epochId", frame.getString("epochId"))
            .put("revision", frame.getString("revision"))
            .put("watermark", frame.getString("watermark"))
            .toString(),
        )) {
          retireHeadlessV2(savedServerId, subscription, reconnect = true)
        }
      }
      "reinitialize" -> retireHeadlessV2(savedServerId, subscription, reconnect = true)
    }
  }

  private fun sendHeadlessV2(subscription: HeadlessV2Subscription, text: String): Boolean =
    runCatching {
      authenticatedTransportLeases.send(subscription.handle, subscription.channelId, text)
    }.isSuccess

  @Synchronized
  private fun retireHeadlessV2(
    savedServerId: String,
    subscription: HeadlessV2Subscription,
    reconnect: Boolean,
  ) {
    if (!headlessV2Subscriptions.remove(savedServerId, subscription)) return
    authenticatedTransportLeases.release(subscription.handle)
    headlessV2FairScheduler.remove(savedServerId)
    admitNextWaitingHeadlessV2()
    updateNotification()
    if (!reconnect || destroyed || syncGeneration != NativeSyncGeneration.V2) return
    val delay = headlessV2ReconnectPolicy.nextDelay(savedServerId, activeDefaultNetwork != null) ?: return
    handler.postDelayed({ ensureHeadlessV2(savedServerId) }, delay)
  }

  @Synchronized
  private fun stopHeadlessV2(savedServerId: String) {
    headlessV2FairScheduler.remove(savedServerId)
    val subscription = headlessV2Subscriptions.remove(savedServerId)
    if (subscription != null) authenticatedTransportLeases.release(subscription.handle)
  }

  private fun stopAllHeadlessV2() {
    handler.removeCallbacks(headlessV2FairnessRunnable)
    headlessV2FairnessScheduled = false
    headlessV2Subscriptions.keys.toList().forEach(::stopHeadlessV2)
    headlessV2FairScheduler.clear()
  }

  @Synchronized
  private fun admitNextWaitingHeadlessV2() {
    val candidate = headlessV2FairScheduler.nextWaiting() ?: return
    ensureHeadlessV2(candidate)
  }

  @Synchronized
  private fun scheduleHeadlessV2Fairness() {
    if (headlessV2FairnessScheduled || destroyed || syncGeneration != NativeSyncGeneration.V2) return
    if (activeDefaultNetwork == null || !headlessV2FairScheduler.hasWaiting()) return
    headlessV2FairnessScheduled = true
    handler.postDelayed(headlessV2FairnessRunnable, HEADLESS_V2_FAIRNESS_INTERVAL_MS)
  }

  @Synchronized
  private fun runHeadlessV2FairnessCycle() {
    if (destroyed || syncGeneration != NativeSyncGeneration.V2 || activeDefaultNetwork == null) return
    val rotation = headlessV2FairScheduler.nextRotation()
    if (rotation != null) {
      stopHeadlessV2(rotation.retiringServerId)
      headlessV2FairScheduler.enqueue(rotation.retiringServerId)
      ensureHeadlessV2(rotation.waitingServerId)
    } else {
      admitNextWaitingHeadlessV2()
    }
    if (headlessV2FairScheduler.hasWaiting()) scheduleHeadlessV2Fairness()
  }

  private fun headlessV2OpenFrame(): String = JSONObject()
    .put("type", "open")
    .put("version", 2)
    .put(
      "intent",
      JSONObject()
        .put(
          "catalog",
          JSONObject()
            .put("activeLimit", 40)
            .put("archivedLimit", 40),
        )
        .put("currentThread", JSONObject.NULL)
        .put("pendingRequests", "allAccessible"),
    )
    .toString()

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Remote Codex connections", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Keeps remote Codex sessions synchronized"
        setShowBadge(false)
      }
    )
  }

  private fun createActivityNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(ACTIVITY_CHANNEL_ID, "Codex turn updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Completion and failure updates for remote Codex turns"
        setShowBadge(true)
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      }
    )
  }

  private fun notification(): Notification {
    val v2Servers = foregroundV2SyncChannels.servers() + headlessV2Subscriptions.keys
    val connectedServers = if (syncGeneration == NativeSyncGeneration.V2) v2Servers.size else sessions.size
    val activeTurns = sessions.values.sumOf {
      if (v2Servers.contains(it.id)) 0 else it.activeThreadCount()
    } + v2Servers.sumOf { v2NotificationProjections[it]?.activeThreadCount() ?: 0 }
    val approvals = sessions.values.sumOf {
      if (v2Servers.contains(it.id)) 0 else it.pendingApprovalCount()
    } + v2Servers.sumOf { v2NotificationProjections[it]?.pendingRequestCount() ?: 0 }
    val summary = if (connectedServers == 0) {
      "Ready for remote connections"
    } else {
      buildList {
        add("$connectedServers connection${if (connectedServers == 1) "" else "s"}")
        if (activeTurns > 0) add("$activeTurns active")
        if (approvals > 0) add("$approvals approval${if (approvals == 1) "" else "s"}")
      }.joinToString(" · ")
    }
    val openApp = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return notificationBuilder(CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle("CodeWide")
      .setContentText(summary)
      .setContentIntent(openApp)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  private fun updateNotification() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
  }

  private fun notificationBuilder(channelId: String): NotificationCompat.Builder =
    NotificationCompat.Builder(this, channelId).setColor(Color.WHITE)

  private fun notifyTurnFinished(connectionId: String, threadId: String, failed: Boolean) {
    val deepLink = Uri.Builder()
      .scheme("codewide")
      .authority("thread")
      .appendQueryParameter("savedServerId", connectionId)
      .appendQueryParameter("connectionId", connectionId)
      .appendQueryParameter("threadId", threadId)
      .build()
    val openThread = PendingIntent.getActivity(
      this,
      ("$connectionId\u0000$threadId").hashCode(),
      Intent(Intent.ACTION_VIEW, deepLink, this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val publicVersion = notificationBuilder(ACTIVITY_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle("CodeWide")
      .setContentText("A remote turn finished")
      .build()
    val notification = notificationBuilder(ACTIVITY_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle(if (failed) "Codex turn failed" else "Codex turn completed")
      .setContentText("Tap to open the thread")
      .setContentIntent(openThread)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .build()
    getSystemService(NotificationManager::class.java).notify(("turn:$connectionId\u0000$threadId").hashCode(), notification)
  }

  private fun notifyApproval(connectionId: String, threadId: String?, requestId: String) {
    val intent = (if (threadId.isNullOrBlank()) {
      Intent(this, MainActivity::class.java)
    } else {
      val deepLink = Uri.Builder()
        .scheme("codewide")
        .authority("thread")
        .appendQueryParameter("savedServerId", connectionId)
        .appendQueryParameter("connectionId", connectionId)
        .appendQueryParameter("threadId", threadId)
        .build()
      Intent(Intent.ACTION_VIEW, deepLink, this, MainActivity::class.java)
    }).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val openApproval = PendingIntent.getActivity(
      this,
      ("approval:$connectionId\u0000$requestId").hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val publicVersion = notificationBuilder(ACTIVITY_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle("CodeWide")
      .setContentText("A remote session needs attention")
      .build()
    val notification = notificationBuilder(ACTIVITY_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle("Codex needs approval")
      .setContentText("Open the thread to review the request")
      .setContentIntent(openApproval)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .build()
    getSystemService(NotificationManager::class.java)
      .notify(("approval:$connectionId\u0000$requestId").hashCode(), notification)
  }

  private fun cancelApprovalNotification(connectionId: String, requestId: String) {
    getSystemService(NotificationManager::class.java)
      .cancel(("approval:$connectionId\u0000$requestId").hashCode())
  }

  private fun clearV2NotificationState(savedServerId: String) {
    val projection = v2NotificationProjections.remove(savedServerId)
      ?: v2NotificationProjectionStore.read(savedServerId)?.let(::V2NotificationProjection)
    projection?.closePendingRequests()?.forEach { effect ->
      cancelApprovalNotification(savedServerId, effect.requestKey)
    }
    if (!v2NotificationProjectionStore.remove(savedServerId)) {
      Log.w(LOG_TAG, "Could not remove V2 notification state")
    }
  }

  private fun clearAllV2NotificationState() {
    val savedServerIds = v2NotificationProjections.keys + v2NotificationProjectionStore.savedServerIds()
    savedServerIds.forEach(::clearV2NotificationState)
    v2NotificationProjections.clear()
    if (!v2NotificationProjectionStore.clear()) Log.w(LOG_TAG, "Could not clear V2 notification state")
  }

  private fun observeV2NotificationState(savedServerId: String, text: String) {
    val effects = runCatching {
      v2NotificationProjections
        .computeIfAbsent(savedServerId) {
          V2NotificationProjection(v2NotificationProjectionStore.read(savedServerId))
        }
        .observe(text) { state ->
          if (!v2NotificationProjectionStore.write(savedServerId, state)) {
            Log.w(LOG_TAG, "Could not persist V2 notification state")
          }
        }
    }.getOrElse { return }
    for (effect in effects) {
      when (effect) {
        is V2NotificationEffect.TurnFinished ->
          notifyTurnFinished(savedServerId, effect.threadId, effect.failed)
        is V2NotificationEffect.ApprovalOpened ->
          notifyApproval(savedServerId, effect.threadId, effect.requestKey)
        is V2NotificationEffect.ApprovalClosed ->
          cancelApprovalNotification(savedServerId, effect.requestKey)
      }
    }
    updateNotification()
  }

  private inner class Session(
    val id: String,
    val endpoint: String,
    val token: String,
    val tlsPinSha256: String
  ) {
    private var socket: WebSocket? = null
    private var closed = false
    private var authBlocked = false
    private var connecting = false
    private var reconnectAttempt = 0
    private var reconnectRunnable: Runnable? = null
    private var connectWatchdogRunnable: Runnable? = null
    private var transportGeneration = 0L
    private var connectStartedAt = 0L
    private var outboxDrainRunning = false
    private var outboxWakeRunnable: Runnable? = null
    private var startupTelemetrySent = false
    private var splashExitTelemetrySent = false
    private val activeThreads = ConcurrentHashMap.newKeySet<String>()
    private val pendingApprovals = ConcurrentHashMap.newKeySet<String>()
    private val protocolEngine = NativeProtocolEngine(
      id,
      frameStore,
      handler,
      journalHandler,
      sendFrame = { payload -> socket?.send(payload) == true },
      resetTransport = { reason -> resetTransport("protocol:$reason") },
      onLive = { handler.post { drainOutbox() } },
      telemetry = NativeTelemetryRecorder(::emitTelemetry),
    )

    fun connect() {
      if (closed || authBlocked || connecting || socket != null) return
      connecting = true
      connectStartedAt = SystemClock.elapsedRealtime()
      val generation = ++transportGeneration
      publishStartupTiming(NativeStartupTrace.snapshot())
      emitTelemetry(NativeTelemetryMetric(
        "connection.attempt_started",
        values = mapOf("attempt" to generation, "reconnectAttempt" to reconnectAttempt),
      ))
      emitTransportStatus("connecting")
      scheduleConnectWatchdog(generation)
      // One mTLS handshake proves the device key; the capability remains a
      // separate authorization factor on that same encrypted WebSocket.
      // Keystore access must not block Android's UI/connection handler.
      httpClient.dispatcher.executorService.execute {
        val preparationStartedAt = SystemClock.elapsedRealtimeNanos()
        val prepared = runCatching {
          InnerTlsTransport.client(httpClient, currentSaved(), "socket", contextualTelemetry(generation, "socket"))
        }
        contextualTelemetry(generation, "socket").record(NativeTelemetryMetric(
          "connection.prepare",
          values = mapOf("durationMs" to elapsedMilliseconds(preparationStartedAt)),
          tags = mapOf("outcome" to if (prepared.isSuccess) "completed" else "failed"),
        ))
        handler.post {
          if (closed || generation != transportGeneration) return@post
          prepared.fold(
            onSuccess = { client -> openSocket(client, generation) },
            onFailure = ::failConnect,
          )
        }
      }
    }

    private fun failConnect(error: Throwable) {
      connecting = false
      cancelConnectWatchdog()
      if (error is SessionAuthorizationException) {
        authBlocked = true
        emitTransportStatus("authRequired")
      } else {
        emitTransportStatus("degraded", transportDiagnostic(error, "Could not establish secure transport"))
        scheduleReconnect()
      }
    }

    private fun currentSaved(): StoredNativeSession {
      val persisted = credentialsStore.get(id)
      return StoredNativeSession(
        id = id,
        endpoint = endpoint,
        token = token,
        tlsPinSha256 = persisted?.tlsPinSha256,
        enabled = persisted?.enabled ?: true,
        innerTlsPinSha256 = tlsPinSha256,
      )
    }

    private fun openSocket(sessionClient: OkHttpClient, generation: Long) {
      if (closed || generation != transportGeneration) return
      authBlocked = false
      val request = Request.Builder()
        .url(InnerTlsTransport.url(endpoint, endpoint))
        .header("Authorization", "Bearer $token")
        .build()
      val socketStartedAt = SystemClock.elapsedRealtime()
      val socketPurpose = "socket"
      emitTelemetry(NativeTelemetryMetric(
        "connection.websocket",
        values = mapOf("attempt" to generation),
        tags = mapOf("phase" to "started", "purpose" to socketPurpose),
      ))
      var openedAtMs: Long? = null
      val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          if (socket !== webSocket || closed || generation != transportGeneration) {
            webSocket.close(1000, "superseded")
            return
          }
          connecting = false
          cancelConnectWatchdog()
          reconnectAttempt = 0
          openedAtMs = SystemClock.elapsedRealtime()
          emitTelemetry(NativeTelemetryMetric(
            "connection.websocket",
            values = mapOf(
              "attempt" to generation,
              "durationMs" to (SystemClock.elapsedRealtime() - socketStartedAt),
              "httpStatus" to response.code,
            ),
            tags = mapOf("phase" to "completed", "purpose" to socketPurpose),
          ))
          emitTelemetry(NativeTelemetryMetric(
            "connection.transport_opened",
            values = mapOf(
              "attempt" to generation,
              "durationMs" to (SystemClock.elapsedRealtime() - connectStartedAt),
            ),
          ))
          protocolEngine.onSocketOpen()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          if (closed) return
          if (socket !== webSocket) return
          observeNotificationState(text)
          protocolEngine.onFrame(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          if (socket !== webSocket || closed) return
          webSocket.close(1003, "text_frames_only")
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          if (socket !== webSocket) return
          webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (socket !== webSocket) return
          socket = null
          connecting = false
          cancelConnectWatchdog()
          protocolEngine.onSocketClosed(if (reason.isBlank()) "Connection interrupted" else reason)
          if (code == 4003) authBlocked = true
          emitTelemetry(NativeTelemetryMetric(
            "connection.websocket_disconnected",
            values = mapOf(
              "attempt" to generation,
              "connectedDurationMs" to maxOf(0L, SystemClock.elapsedRealtime() - (openedAtMs ?: socketStartedAt)),
              "closeCode" to code,
            ),
            tags = mapOf("purpose" to socketPurpose, "failureKind" to "closed"),
          ))
          if (authBlocked) emitTransportStatus("authRequired") else {
            emitTransportStatus("degraded", if (reason.isBlank()) "Connection interrupted" else reason.take(240))
            scheduleReconnect()
          }
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
          if (socket !== webSocket) return
          socket = null
          connecting = false
          cancelConnectWatchdog()
          protocolEngine.onSocketClosed(throwable.javaClass.simpleName)
          Log.w(LOG_TAG, "websocket failure ${throwable.javaClass.simpleName} id=${safeConnectionId(id)}")
          val openedAt = openedAtMs
          if (openedAt == null) {
            emitTelemetry(NativeTelemetryMetric(
              "connection.websocket",
              values = mapOf(
                "attempt" to generation,
                "durationMs" to (SystemClock.elapsedRealtime() - socketStartedAt),
                "httpStatus" to (response?.code ?: 0),
              ),
              tags = mapOf(
                "phase" to "failed",
                "purpose" to socketPurpose,
                "failureKind" to throwable.javaClass.simpleName,
              ),
            ))
            emitTelemetry(NativeTelemetryMetric(
              "connection.attempt_failed",
              values = mapOf(
                "attempt" to generation,
                "durationMs" to (SystemClock.elapsedRealtime() - connectStartedAt),
              ),
              tags = mapOf("stage" to "websocket", "failureKind" to throwable.javaClass.simpleName),
            ))
          } else {
            emitTelemetry(NativeTelemetryMetric(
              "connection.websocket_disconnected",
              values = mapOf(
                "attempt" to generation,
                "connectedDurationMs" to maxOf(0L, SystemClock.elapsedRealtime() - openedAt),
                "httpStatus" to (response?.code ?: 0),
              ),
              tags = mapOf("purpose" to socketPurpose, "failureKind" to throwable.javaClass.simpleName),
            ))
          }
          if (response?.code == 401 || response?.code == 403) {
            authBlocked = true
            emitTransportStatus("authRequired")
          } else {
            emitTransportStatus("degraded", transportDiagnostic(throwable, "Connection failed"))
            scheduleReconnect()
          }
        }
      }
      val created = sessionClient.newWebSocket(request, listener)
      socket = created
    }


    fun send(payload: String): Boolean = socket?.send(payload) == true

    fun replayBuffered() {
      protocolEngine.attachRuntime()
    }

    fun attachRuntime() {
      val startedAt = SystemClock.elapsedRealtimeNanos()
      protocolEngine.attachRuntime()
      emitTelemetry(NativeTelemetryMetric(
        "connection.runtime_attach",
        values = mapOf("durationMs" to elapsedMilliseconds(startedAt), "attempt" to transportGeneration),
        tags = mapOf("transport" to when {
          connecting -> "connecting"
          socket != null -> "retained"
          else -> "missing"
        }),
      ))
      publishStartupTiming(NativeStartupTrace.snapshot())
      handler.post { if (!destroyed) reconnectNow() }
    }

    fun rpc(method: String, params: Any?, completion: (Result<Any?>) -> Unit) {
      if (closed) {
        completion(Result.failure(IllegalStateException("Connection session is closed")))
        return
      }
      if (authBlocked) {
        completion(Result.failure(IllegalStateException("Authorization required")))
        return
      }
      reconnectNow()
      protocolEngine.rpc(method, params, completion = completion)
    }

    fun drainOutbox() {
      if (closed || outboxDrainRunning || !protocolEngine.isLive()) return
      outboxWakeRunnable?.let(handler::removeCallbacks)
      outboxWakeRunnable = null
      val command = commandStore.nextReady(id)
      if (command == null) {
        scheduleOutboxWake()
        return
      }
      outboxDrainRunning = true
      val params = runCatching { org.json.JSONTokener(command.paramsJson).nextValue() }.getOrElse { error ->
        val failed = commandStore.markFailed(command, "Invalid persisted command payload: ${error.javaClass.simpleName}")
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(failed), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      if (command.state == "uncertain") {
        when (NativeCommandPolicy.reconciliation(command.method)) {
          NativeCommandReconciliation.TURN_BY_CLIENT_MESSAGE -> {
            reconcileTurnCommand(command, params)
            return
          }
          NativeCommandReconciliation.SERVER_REQUEST_BY_PENDING_SET -> {
            reconcileServerResponse(command, params)
            return
          }
          else -> Unit
        }
      }
      dispatchCommand(command, params)
    }

    private fun reconcileServerResponse(command: NativeCommand, params: Any?) {
      val requestId = (params as? JSONObject)?.opt("requestId")
      if (requestId == null || requestId === JSONObject.NULL) {
        val failed = commandStore.markFailed(command, "Persisted server response has no request id")
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(failed), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      if (!pendingApprovals.contains(approvalRequestKey(requestId))) {
        val delivered = commandStore.markDelivered(command)
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(delivered), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      dispatchCommand(command, params)
    }

    private fun reconcileTurnCommand(command: NativeCommand, params: Any?) {
      val payload = params as? JSONObject
      val threadId = payload?.optString("threadId")?.takeIf { it.isNotBlank() }
      if (threadId == null) {
        val failed = commandStore.markFailed(command, "Persisted turn command has no thread id")
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(failed), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      protocolEngine.rpc(
        "thread/turns/list",
        JSONObject()
          .put("threadId", threadId)
          .put("cursor", JSONObject.NULL)
          .put("limit", 2)
          .put("sortDirection", "desc")
          .put("itemsView", "summary"),
      ) { result ->
        handler.post {
          result.fold(
            onSuccess = { response ->
              if (turnsContainClientMessage(response, command.commandId)) {
                val delivered = commandStore.markDelivered(command)
                CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(delivered), null)
                outboxDrainRunning = false
                drainOutbox()
              } else if (turnsContainActiveTurn(response)) {
                val retryAt = System.currentTimeMillis() + OUTBOX_RECONCILE_DELAY_MS
                val waiting = commandStore.markUncertain(command, "Waiting for authoritative thread reconciliation", retryAt)
                CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(waiting), null)
                outboxDrainRunning = false
                drainOutbox()
              } else {
                dispatchCommand(command, params)
              }
            },
            onFailure = { error ->
              val waiting = commandStore.markUncertain(
                command,
                error.message ?: "Turn reconciliation interrupted",
                System.currentTimeMillis() + OUTBOX_RECONCILE_DELAY_MS,
              )
              CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(waiting), null)
              outboxDrainRunning = false
              if (protocolEngine.isLive()) drainOutbox()
            },
          )
        }
      }
    }

    private fun dispatchCommand(command: NativeCommand, params: Any?) {
      if (command.method == "serverRequest/respond") {
        dispatchServerResponse(command, params)
        return
      }
      val outbound = runCatching { outboundCommand(command, params) }.getOrElse { error ->
        val failed = commandStore.markFailed(command, error.message ?: "Invalid persisted command")
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(failed), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      val sending = commandStore.markSending(command)
      CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(sending), null)
      protocolEngine.rpc(outbound.first, outbound.second) { result ->
        handler.post {
          result.fold(
            onSuccess = {
              // A turn/start response now acknowledges durable admission by
              // the companion outbox, not direct App Server delivery. From
              // this point the host is the sole retry owner; the retained
              // native receipt only keeps the optimistic bubble visible.
              if (sending.method == "turn/interrupt") {
                (params as? JSONObject)?.optString("threadId")?.takeIf { it.isNotBlank() }?.let { threadId ->
                  commandStore.expediteTurnReconciliation(id, threadId)
                }
              }
              val delivered = commandStore.markDelivered(sending)
              CodeWideModule.emitEngineEvent(
                id,
                "outbox",
                commandStore.stateJson(delivered),
                null,
              )
            },
            onFailure = { error ->
              val updated = if (error is NativeRpcException) {
                commandStore.markFailed(sending, error.message ?: "Remote command rejected")
              } else {
                val retryDelayMs = minOf(30_000L, 500L * (1L shl minOf(sending.attempts, 6)))
                commandStore.markUncertain(
                  sending,
                  error.message ?: "Remote command delivery interrupted",
                  System.currentTimeMillis() + retryDelayMs,
                )
              }
              CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(updated), null)
            },
          )
          outboxDrainRunning = false
          if (protocolEngine.isLive()) drainOutbox()
        }
      }
    }

    private fun outboundCommand(command: NativeCommand, params: Any?): Pair<String, Any?> {
      if (command.method != "turn/start") return command.method to params
      val turnParams = params as? JSONObject
        ?: throw IllegalArgumentException("Persisted turn/start params must be an object")
      val threadId = turnParams.optString("threadId").takeIf { it.isNotBlank() }
        ?: throw IllegalArgumentException("Persisted turn/start has no thread id")
      val queued = JSONObject()
        .put("commandId", command.commandId)
        .put("remoteThreadId", threadId)
        .put("method", "turn/start")
        .put("presentation", "delivery")
        .put("params", turnParams)
        .put("createdAt", command.createdAt)
      return "companion/queue/put" to JSONObject().put("command", queued)
    }

    private fun dispatchServerResponse(command: NativeCommand, params: Any?) {
      val payload = params as? JSONObject
      val requestId = payload?.opt("requestId")
      if (requestId == null || requestId === JSONObject.NULL) {
        val failed = commandStore.markFailed(command, "Persisted server response has no request id")
        CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(failed), null)
        outboxDrainRunning = false
        drainOutbox()
        return
      }
      val sending = commandStore.markSending(command)
      CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(sending), null)
      protocolEngine.respondToServerRequest(requestId, payload.opt("result")) { result ->
        handler.post {
          result.fold(
            onSuccess = {
              val delivered = commandStore.markDelivered(sending)
              CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(delivered), null)
            },
            onFailure = { error ->
              val updated = if (error is NativeRpcException) {
                commandStore.markFailed(sending, error.message ?: "Server response rejected")
              } else {
                commandStore.markUncertain(
                  sending,
                  error.message ?: "Server response delivery interrupted",
                  System.currentTimeMillis() + OUTBOX_RECONCILE_DELAY_MS,
                )
              }
              CodeWideModule.emitEngineEvent(id, "outbox", commandStore.stateJson(updated), null)
            },
          )
          outboxDrainRunning = false
          if (protocolEngine.isLive()) drainOutbox()
        }
      }
    }

    private fun turnsContainClientMessage(response: Any?, commandId: String): Boolean {
      val turns = (response as? JSONObject)?.optJSONArray("data") ?: return false
      for (turnIndex in 0 until turns.length()) {
        val items = turns.optJSONObject(turnIndex)?.optJSONArray("items") ?: continue
        for (itemIndex in 0 until items.length()) {
          val item = items.optJSONObject(itemIndex) ?: continue
          if (item.optString("type") == "userMessage" && item.optString("clientId") == commandId) return true
        }
      }
      return false
    }

    private fun turnsContainActiveTurn(response: Any?): Boolean {
      val turns = (response as? JSONObject)?.optJSONArray("data") ?: return false
      for (turnIndex in 0 until turns.length()) {
        val status = turns.optJSONObject(turnIndex)?.opt("status")
        if (status == "inProgress") return true
        val type = (status as? JSONObject)?.optString("type")
        if (type == "active" || type == "inProgress") return true
      }
      return false
    }

    private fun scheduleOutboxWake() {
      if (closed || !protocolEngine.isLive() || outboxWakeRunnable != null) return
      val wakeAt = commandStore.nextWakeAt(id) ?: return
      val runnable = Runnable {
        outboxWakeRunnable = null
        drainOutbox()
      }
      outboxWakeRunnable = runnable
      handler.postDelayed(runnable, maxOf(0L, wakeAt - System.currentTimeMillis()))
    }

    fun reconnectNow() {
      if (closed || authBlocked) return
      if (connecting) {
        if (SystemClock.elapsedRealtime() - connectStartedAt >= STALE_CONNECT_WAKE_MS) {
          resetTransport("stale_connect_wake")
        }
        return
      }
      // An open WebSocket is owned by OkHttp and already has a ping watchdog.
      // `wake` must never recycle it merely because the companion is syncing
      // or reconnecting its own App Server upstream: that status is delivered
      // over this same socket and will recover without a second handshake.
      if (socket != null) return
      reconnectRunnable?.let(handler::removeCallbacks)
      reconnectRunnable = null
      connect()
    }

    fun networkLost() {
      if (closed) return
      transportGeneration += 1
      reconnectRunnable?.let(handler::removeCallbacks)
      reconnectRunnable = null
      cancelConnectWatchdog()
      val active = socket
      socket = null
      connecting = false
      active?.cancel()
      protocolEngine.onSocketClosed("Network unavailable")
      emitTelemetry(NativeTelemetryMetric(
        "connection.network_lost",
        values = mapOf("attempt" to transportGeneration),
      ))
      emitTransportStatus("offline")
    }

    fun resetTransport(reason: String) {
      if (closed) return
      Log.w(LOG_TAG, "reset transport reason=${reason.take(120)} id=${safeConnectionId(id)}")
      emitTelemetry(NativeTelemetryMetric(
        "connection.transport_reset",
        values = mapOf(
          "attempt" to transportGeneration,
          "durationMs" to maxOf(0L, SystemClock.elapsedRealtime() - connectStartedAt),
        ),
        tags = mapOf("reason" to reason.take(120)),
      ))
      transportGeneration += 1
      reconnectRunnable?.let(handler::removeCallbacks)
      reconnectRunnable = null
      cancelConnectWatchdog()
      val active = socket
      socket = null
      connecting = false
      active?.cancel()
      if (reason == "user_reconnect" || reason == "stale_connect_wake") {
        reconnectAttempt = 0
        reconnectNow()
      } else if (reason == "connect_watchdog") {
        protocolEngine.onSocketClosed("Connection attempt timed out")
        emitTransportStatus("degraded", "Connection attempt timed out")
        scheduleReconnect()
      } else {
        scheduleReconnect()
      }
    }

    fun close(reason: String) {
      closed = true
      transportGeneration += 1
      reconnectRunnable?.let(handler::removeCallbacks)
      reconnectRunnable = null
      cancelConnectWatchdog()
      outboxWakeRunnable?.let(handler::removeCallbacks)
      outboxWakeRunnable = null
      socket?.close(1000, reason)
      socket = null
      pendingApprovals.forEach { cancelApprovalNotification(id, it) }
      pendingApprovals.clear()
      protocolEngine.close(reason)
    }

    fun activeThreadCount(): Int = activeThreads.size

    fun pendingApprovalCount(): Int = pendingApprovals.size

    private fun approvalRequestKey(value: Any): String = when (value) {
      is Number -> "number:$value"
      else -> "string:$value"
    }


    private fun emitTransportStatus(status: String, diagnostic: String? = null) {
      protocolEngine.onTransportState(status, diagnostic)
    }

    private fun observeNotificationState(text: String) {
      if (syncGeneration == NativeSyncGeneration.V2) return
      runCatching {
        val envelope = JSONObject(text)
        if (envelope.optString("type") == "hello") {
          val previous = pendingApprovals.toSet()
          pendingApprovals.clear()
          val pending = envelope.optJSONArray("pendingRequests")
          if (pending != null) {
            for (index in 0 until pending.length()) {
              val request = pending.optJSONObject(index) ?: continue
              if (!USER_APPROVAL_METHODS.contains(request.optString("method"))) continue
              val requestId = request.opt("id")
              if (requestId == null || requestId === JSONObject.NULL) continue
              val requestKey = approvalRequestKey(requestId)
              pendingApprovals.add(requestKey)
              if (!previous.contains(requestKey)) {
                val threadId = request.optJSONObject("params")?.optString("threadId")?.takeIf { it.isNotBlank() }
                notifyApproval(id, threadId, requestKey)
              }
            }
          }
          previous.filterNot(pendingApprovals::contains).forEach { cancelApprovalNotification(id, it) }
          if (previous != pendingApprovals) updateNotification()
          return
        }
        if (envelope.optString("type") != "event") return
        val payload = envelope.optJSONObject("payload") ?: return
        val method = payload.optString("method")
        val params = payload.optJSONObject("params")
        val threadId = params?.optString("threadId")?.takeIf { it.isNotBlank() }
        var changed = false
        when (method) {
          "thread/status/changed" -> {
            if (threadId == null) return
            changed = if (params?.optJSONObject("status")?.optString("type") == "active") activeThreads.add(threadId)
            else activeThreads.remove(threadId)
          }
          "turn/completed" -> if (threadId != null) {
            val wasActive = activeThreads.remove(threadId)
            changed = wasActive
            if (wasActive) {
              val status = params?.optJSONObject("turn")?.optString("status").orEmpty()
              notifyTurnFinished(id, threadId, status == "failed")
            }
          }
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
          "item/permissions/requestApproval",
          "mcpServer/elicitation/request" -> {
            val requestId = payload.opt("id")
            if (requestId != null && requestId !== JSONObject.NULL) {
              val requestKey = approvalRequestKey(requestId)
              changed = pendingApprovals.add(requestKey)
              if (changed) notifyApproval(id, threadId, requestKey)
            }
          }
          "serverRequest/resolved" -> {
            val requestId = params?.opt("requestId")
            if (requestId != null && requestId !== JSONObject.NULL) {
              val requestKey = approvalRequestKey(requestId)
              changed = pendingApprovals.remove(requestKey)
              cancelApprovalNotification(id, requestKey)
            }
          }
        }
        if (changed) updateNotification()
      }
    }

    private fun scheduleReconnect() {
      if (closed || reconnectRunnable != null) return
      val delay = minOf(MAX_RECONNECT_DELAY_MS, 500L * (1L shl minOf(reconnectAttempt, 1)))
      reconnectAttempt += 1
      emitTelemetry(NativeTelemetryMetric(
        "connection.retry_scheduled",
        values = mapOf("delayMs" to delay, "reconnectAttempt" to reconnectAttempt),
      ))
      val runnable = Runnable {
        reconnectRunnable = null
        connect()
      }
      reconnectRunnable = runnable
      handler.postDelayed(runnable, delay)
    }

    private fun scheduleConnectWatchdog(generation: Long) {
      cancelConnectWatchdog()
      val runnable = Runnable {
        connectWatchdogRunnable = null
        if (closed || generation != transportGeneration || !connecting) return@Runnable
        resetTransport("connect_watchdog")
      }
      connectWatchdogRunnable = runnable
      handler.postDelayed(runnable, CONNECT_WATCHDOG_MS)
    }

    private fun cancelConnectWatchdog() {
      connectWatchdogRunnable?.let(handler::removeCallbacks)
      connectWatchdogRunnable = null
    }

    private fun transportDiagnostic(error: Throwable, fallback: String): String {
      val detail = error.message?.trim()?.takeIf { it.isNotBlank() }?.take(200)
      return if (detail == null) "$fallback (${error.javaClass.simpleName})" else "$fallback: $detail"
    }

    fun publishStartupTiming(timing: NativeStartupTiming?) {
      if (timing == null) return
      if (!startupTelemetrySent) {
        startupTelemetrySent = true
        emitTelemetry(NativeTelemetryMetric(
          "app.splash_hide_requested",
          values = mapOf(
            "applicationOnCreateMs" to timing.applicationOnCreateMs,
            "applicationEntryToContentMs" to timing.applicationEntryToContentMs,
            "activityToContentMs" to timing.activityToContentMs,
            "applicationReadyToContentMs" to timing.applicationReadyToContentMs,
          ),
          tags = mapOf("startKind" to "cold"),
        ))
      }
      val exit = timing.splashExit ?: return
      if (splashExitTelemetrySent) return
      splashExitTelemetrySent = true
      emitTelemetry(NativeTelemetryMetric(
        "app.splash_removed",
        values = mapOf(
          "contentToExitMs" to exit.contentToExitMs,
          "animationStartDelayMs" to exit.animationStartDelayMs,
          "animationDurationMs" to exit.animationDurationMs,
          "applicationEntryToSplashRemovedMs" to exit.applicationEntryToSplashRemovedMs,
        ),
        tags = mapOf("startKind" to "cold", "outcome" to if (exit.cancelled) "cancelled" else "completed"),
      ))
    }

    fun publishProcessExitTelemetry(metric: NativeTelemetryMetric) {
      emitTelemetry(metric)
    }

    private fun contextualTelemetry(generation: Long, purpose: String): NativeTelemetryRecorder =
      NativeTelemetryRecorder { metric ->
        val values = linkedMapOf<String, Number>("attempt" to generation)
        values.putAll(metric.values)
        val tags = linkedMapOf("purpose" to purpose)
        tags.putAll(metric.tags)
        emitTelemetry(NativeTelemetryMetric(metric.name, values, tags))
      }

    private fun emitTelemetry(metric: NativeTelemetryMetric) {
      CodeWideModule.emitEngineEvent(id, "telemetry", metric.toJson(), null)
    }
  }

  companion object {
    private const val LOG_TAG = "CodeWideTransport"
    const val ACTION_ATTACH = "dev.codexremote.app.ATTACH"
    const val ACTION_CLOSE = "dev.codexremote.app.CLOSE"
    const val ACTION_WAKE = "dev.codexremote.app.WAKE"
    const val ACTION_ACTIVATE_V2 = "dev.codewide.app.ACTIVATE_V2"
    const val ACTION_STOP_ALL = "dev.codexremote.app.STOP_ALL"
    const val EXTRA_CONNECTION_ID = "connection_id"
    private const val CHANNEL_ID = "codewide_connections"
    private const val ACTIVITY_CHANNEL_ID = "codewide_turn_updates"
    private const val NOTIFICATION_ID = 4107
    private const val CREDENTIAL_HTTP_TIMEOUT_MS = 12_000L
    private const val MAX_RECONNECT_DELAY_MS = 1_000L
    private const val STALE_CONNECT_WAKE_MS = 8_000L
    private const val CONNECT_WATCHDOG_MS = 20_000L
    private const val OUTBOX_RECONCILE_DELAY_MS = 2_000L
    // Avoid monopolizing process capacity in the common case. If other native
    // resources consume the reserve, explicit work preempts the oldest headless owner.
    private const val MAX_HEADLESS_V2_SUBSCRIPTIONS = 63
    private const val HEADLESS_V2_FAIRNESS_INTERVAL_MS = 30_000L
    private val USER_APPROVAL_METHODS = setOf(
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/tool/requestUserInput",
      "item/permissions/requestApproval",
      "mcpServer/elicitation/request",
    )
    @Volatile var instance: CodexConnectionService? = null

    private fun safeConnectionId(id: String): String = id.take(8).replace(Regex("[^A-Za-z0-9._-]"), "_")
  }
}
