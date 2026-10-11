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
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import dev.codewide.app.diagnostics.NativeAppLogger
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

  private lateinit var frameStore: NativeFrameStore
  private lateinit var commandStore: NativeCommandStore
  private lateinit var credentialsStore: NativeSessionCredentialsStore
  private lateinit var portForwardManager: NativePortForwardManager
  private lateinit var terminalSessionManager: NativeTerminalSessionManager
  private lateinit var companionHttpProxy: NativeCompanionHttpProxy
  private lateinit var processExitTelemetry: NativeProcessExitTelemetry
  private lateinit var diagnosticUploader: NativeDiagnosticUploader
  private lateinit var connectivityManager: ConnectivityManager
  private val handler = Handler(Looper.getMainLooper())
  private val recoveryWorker = NativeRecoveryWorker()
  private val journalThread = HandlerThread("CodeWideJournal")
  private lateinit var journalHandler: Handler
  private val sessions = ConcurrentHashMap<String, Session>()
  @Volatile private var destroyed = false
  private val networkState = DefaultNetworkState<Network>()
  private var processExitTelemetryCollectionStarted = false
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) {
      synchronized(this@CodexConnectionService) {
        if (destroyed) return
        if (networkState.available(network)) publishNetworkObservation(true)
      }
    }

    override fun onLost(network: Network) {
      synchronized(this@CodexConnectionService) {
        if (destroyed) return
        if (networkState.lost(network)) publishNetworkObservation(false)
      }
    }

    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
      synchronized(this@CodexConnectionService) {
        if (destroyed) return
        if (networkState.capabilities(network,
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL))) {
          publishNetworkObservation(false)
        }
      }
    }

    override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
      synchronized(this@CodexConnectionService) {
        if (destroyed) return
        if (networkState.blocked(network, blocked)) publishNetworkObservation(!blocked)
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
    diagnosticUploader = NativeDiagnosticUploader(credentialsStore)
    diagnosticUploader.start()
    portForwardManager = NativePortForwardManager(this, credentialsStore, httpClient)
    terminalSessionManager = NativeTerminalSessionManager(credentialsStore, credentialHttpClient, httpClient, cacheDir)
    companionHttpProxy = NativeCompanionHttpProxy(credentialsStore)
    connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val initialNetwork = connectivityManager.activeNetwork
    if (initialNetwork == null) networkState.absent() else networkState.available(initialNetwork)
    createNotificationChannel()
    createActivityNotificationChannel()
    startForeground(NOTIFICATION_ID, notification())
    connectivityManager.registerDefaultNetworkCallback(networkCallback, handler)
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
            terminalSessionManager.activateGeneration()
            attach(id)
          }
        }
      }
      ACTION_CLOSE -> intent.getStringExtra(EXTRA_CONNECTION_ID)?.let(::close)
      ACTION_WAKE -> {
        intent.getStringExtra(EXTRA_CONNECTION_ID)?.let(::wake)
      }
      ACTION_STOP_ALL -> stopSelf()
      null -> recoveryWorker.submit {
        synchronized(this) {
          if (!destroyed) activateLegacySync()
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    processNativeAuthorityLifecycle.access {
      synchronized(this) {
        destroyed = true
        diagnosticUploader.close()
        recoveryWorker.close()
        handler.removeCallbacksAndMessages(null)
        sessions.values.forEach { it.close("service_destroyed") }
        sessions.clear()
        portForwardManager.close()
        terminalSessionManager.destroy()
        companionHttpProxy.close()
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        httpClient.dispatcher.executorService.shutdown()
        if (instance === this) instance = null
        commandStore.close()
        journalThread.quitSafely()
      }
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun publishNetworkObservation(routeAvailable: Boolean) {
    sessions.values.forEach { session ->
      session.publishNetworkObservation()
      if (!networkState.canAttempt) session.networkLost()
      else if (routeAvailable) session.networkAvailable()
    }
  }

  @Synchronized
  internal fun open(id: String, endpoint: String, token: String, tlsPinSha256: String, relay: PinnedRelayRoute? = null) {
    val existing = sessions[id]
    if (existing != null && existing.endpoint == endpoint && existing.token == token && existing.tlsPinSha256 == tlsPinSha256 && existing.relay == relay) {
      // Attaching a recreated React runtime must not cancel the service-owned
      // socket. Replay the latest protocol checkpoint and durable event tail so
      // the new SyncSession can resume immediately on the existing transport.
      existing.attachRuntime()
      return
    }
    existing?.close("connection_replaced")
    val session = Session(id, endpoint, token, tlsPinSha256, relay)
    sessions[id] = session
    session.publishNetworkObservation()
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

  // Compatibility bridge name; this is a cache read, never a network scan.
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

  internal fun listTerminals(): String = terminalSessionManager.listRunning()

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
      && existing.relay == saved.relay
    ) {
      existing.attachRuntime()
      collectPreviousProcessExit(existing)
      return
    }
    open(saved.id, saved.endpoint, saved.token, saved.innerTlsPinSha256, saved.relay)
    sessions[connectionId]?.let(::collectPreviousProcessExit)
  }

  private fun collectPreviousProcessExit(session: Session) {
    if (processExitTelemetryCollectionStarted) return
    processExitTelemetryCollectionStarted = true
    journalHandler.post {
      val collection = runCatching { processExitTelemetry.collect() }
      if (collection.isFailure) {
        NativeAppLogger.warn(LOG_TAG, "Could not collect previous process exits; retrying", collection.exceptionOrNull(), session.id)
        handler.post { retryProcessExitCollection(session) }
        return@post
      }
      val batch = collection.getOrNull() ?: return@post
      handler.post {
        synchronized(this@CodexConnectionService) {
          if (destroyed) return@synchronized
          if (sessions[session.id] !== session) {
            processExitTelemetryCollectionStarted = false
            return@synchronized
          }
          batch.metrics.forEach(session::publishProcessExitTelemetry)
          journalHandler.post {
            if (!processExitTelemetry.acknowledge(batch.checkpointTimestampUnixMs)) {
              handler.post { retryProcessExitCollection(session) }
            }
          }
        }
      }
    }
  }

  private fun retryProcessExitCollection(session: Session) {
    processExitTelemetryCollectionStarted = false
    handler.postDelayed({
      synchronized(this@CodexConnectionService) {
        if (!destroyed && sessions[session.id] === session) collectPreviousProcessExit(session)
      }
    }, 30_000)
  }

  fun rpc(connectionId: String, method: String, params: Any?, completion: (Result<Any?>) -> Unit) {
    val session = sessions[connectionId]
    if (session == null) completion(Result.failure(IllegalStateException("Connection is not enabled")))
    else session.rpc(method, params, completion)
  }

  fun subscribeLive(connectionId: String, channelId: String, threadId: String): Boolean =
    sessions[connectionId]?.subscribeLive(channelId, threadId) == true

  fun unsubscribeLive(connectionId: String, channelId: String): Boolean =
    sessions[connectionId]?.unsubscribeLive(channelId) == true

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
      terminalSessionManager.activateGeneration()
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
      || session.relay != saved.relay
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
    attach(replacement.id)
  }

  @Synchronized
  internal fun activateLegacySync() {
    terminalSessionManager.activateGeneration()
    restoreLegacySync()
    updateNotification()
  }

  private fun restoreLegacySync() {
    credentialsStore.list().filter { it.enabled }.forEach { saved ->
      open(saved.id, saved.endpoint, saved.token, saved.innerTlsPinSha256, saved.relay)
    }
  }

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
    val connectedServers = sessions.size
    val activeTurns = sessions.values.sumOf { it.activeThreadCount() }
    val approvals = sessions.values.sumOf { it.pendingApprovalCount() }
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
      .setContentTitle(if (failed) "Agent turn failed" else "Agent turn completed")
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
      .setContentTitle("Agent needs approval")
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

  private inner class Session(
    val id: String,
    val endpoint: String,
    val token: String,
    val tlsPinSha256: String,
    val relay: PinnedRelayRoute?,
  ) {
    @Volatile private var socket: WebSocket? = null
    @Volatile private var closed = false
    private var authBlocked = false
    private var connecting = false
    private val retryPolicy = TransportRetryPolicy()
    private var reconnectRunnable: Runnable? = null
    private var connectWatchdogRunnable: Runnable? = null
    @Volatile private var transportGeneration = 0L
    private val routeRecovery = TransportRouteRecovery()
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
      resetTransport = { reason ->
        // Never acquire the Session monitor while holding the protocol monitor.
        // A reset queued by an old socket must not tear down a newer generation.
        val generation = transportGeneration
        handler.post { if (generation == transportGeneration) resetTransport("protocol:$reason") }
      },
      onLive = { handler.post { drainOutbox() } },
      onPortInventory = { payload -> portForwardManager.receiveInventory(id, payload) },
      telemetry = NativeTelemetryRecorder(::emitTelemetry),
      onRpcHealth = { available -> retryPolicy.observeRpc(available, SystemClock.elapsedRealtime()) },
    )

    @Synchronized fun connect() {
      if (closed || authBlocked || connecting || socket != null) return
      if (!networkState.canAttempt) {
        emitTransportStatus("offline")
        return
      }
      connecting = true
      routeRecovery.attemptStarted(networkState.epoch)
      connectStartedAt = SystemClock.elapsedRealtime()
      val generation = ++transportGeneration
      publishStartupTiming(NativeStartupTrace.snapshot())
      emitTelemetry(NativeTelemetryMetric(
        "connection.attempt_started",
        values = mapOf("attempt" to generation, "reconnectAttempt" to retryPolicy.attempts),
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

    @Synchronized private fun failConnect(error: Throwable) {
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
        relay = relay,
      )
    }

    @Synchronized private fun openSocket(sessionClient: OkHttpClient, generation: Long) {
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
        override fun onOpen(webSocket: WebSocket, response: Response): Unit = synchronized(this@Session) {
          if (socket !== webSocket || closed || generation != transportGeneration) {
            webSocket.close(1000, "superseded")
            return
          }
          connecting = false
          cancelConnectWatchdog()
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

        override fun onMessage(webSocket: WebSocket, text: String): Unit = synchronized(this@Session) {
          if (closed) return
          if (socket !== webSocket) return
          observeNotificationState(text)
          protocolEngine.onFrame(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString): Unit = synchronized(this@Session) {
          if (socket !== webSocket || closed) return
          webSocket.close(1003, "text_frames_only")
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String): Unit = synchronized(this@Session) {
          if (socket !== webSocket) return
          webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String): Unit = synchronized(this@Session) {
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

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?): Unit = synchronized(this@Session) {
          if (socket !== webSocket) return
          socket = null
          connecting = false
          cancelConnectWatchdog()
          protocolEngine.onSocketClosed(throwable.javaClass.simpleName)
          NativeAppLogger.warn(LOG_TAG, "websocket failure id=${safeConnectionId(id)}", throwable, id)
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

    fun subscribeLive(channelId: String, threadId: String): Boolean =
      !closed && !authBlocked && protocolEngine.subscribeLive(channelId, threadId)

    fun unsubscribeLive(channelId: String): Boolean =
      !closed && protocolEngine.unsubscribeLive(channelId)

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

    @Synchronized fun reconnectNow() {
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
      // UI wake/reattach is not a route change and cannot defeat a pending backoff.
      if (reconnectRunnable != null) return
      connect()
    }

    @Synchronized fun publishNetworkObservation() {
      protocolEngine.onNetworkObservation(networkState.availability, networkState.epoch)
    }

    @Synchronized fun networkAvailable() {
      if (closed || authBlocked) return
      when (routeRecovery.available(networkState.epoch, connecting || socket != null)) {
        TransportRouteRecovery.Action.KEEP -> return
        TransportRouteRecovery.Action.REPLACE -> {
          resetTransport("route_changed")
          return
        }
        TransportRouteRecovery.Action.CONNECT -> Unit
      }
      reconnectRunnable?.let(handler::removeCallbacks)
      reconnectRunnable = null
      connect()
    }

    @Synchronized fun networkLost() {
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
      emitTransportStatus(if (authBlocked) "authRequired" else "offline")
    }

    @Synchronized fun resetTransport(reason: String) {
      if (closed) return
      NativeAppLogger.warn(LOG_TAG, "reset transport reason=${reason} id=${safeConnectionId(id)}", connectionId = id)
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
      protocolEngine.onSocketClosed("Connection interrupted")
      if (reason == "user_reconnect" || reason == "route_changed") {
        if (reason == "user_reconnect") retryPolicy.reset()
        reconnectNow()
      } else if (reason == "connect_watchdog") {
        protocolEngine.onSocketClosed("Connection attempt timed out")
        emitTransportStatus("degraded", "Connection attempt timed out")
        scheduleReconnect()
      } else {
        emitTransportStatus("degraded", "Connection interrupted")
        scheduleReconnect()
      }
    }

    @Synchronized fun close(reason: String) {
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

    @Synchronized private fun scheduleReconnect() {
      if (closed || authBlocked || reconnectRunnable != null) return
      if (!networkState.canAttempt) {
        emitTransportStatus("offline")
        return
      }
      val delay = retryPolicy.nextDelayMs(SystemClock.elapsedRealtime())
      emitTelemetry(NativeTelemetryMetric(
        "connection.retry_scheduled",
        values = mapOf("delayMs" to delay, "reconnectAttempt" to retryPolicy.attempts),
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
    const val ACTION_STOP_ALL = "dev.codexremote.app.STOP_ALL"
    const val EXTRA_CONNECTION_ID = "connection_id"
    private const val CHANNEL_ID = "codewide_connections"
    private const val ACTIVITY_CHANNEL_ID = "codewide_turn_updates"
    private const val NOTIFICATION_ID = 4107
    private const val CREDENTIAL_HTTP_TIMEOUT_MS = 12_000L
    private const val STALE_CONNECT_WAKE_MS = 8_000L
    private const val CONNECT_WATCHDOG_MS = 20_000L
    private const val OUTBOX_RECONCILE_DELAY_MS = 2_000L
    // Avoid monopolizing process capacity in the common case. If other native
    // resources consume the reserve, explicit work preempts the oldest headless owner.
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
