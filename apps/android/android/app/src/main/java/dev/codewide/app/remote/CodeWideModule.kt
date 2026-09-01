package dev.codewide.app.remote

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.net.Uri
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.format.DateFormat
import android.util.Base64
import android.util.Log
import android.view.View
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import dev.codewide.app.rendering.VoiceAuraRenderEffect
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.sqrt
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import org.json.JSONTokener

class CodeWideModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class CaptureSource(val value: Int, val label: String)

  private data class PcmCaptureSession(
    val recorder: AudioRecord,
    val source: CaptureSource,
    val sampleRate: Int,
    val noiseSuppressor: NoiseSuppressor?,
    val automaticGainControl: AutomaticGainControl?,
  )

  private var speechRecognizer: SpeechRecognizer? = null
  private var voiceGeneration = 0L
  @Volatile private var audioCaptureRunning = false
  private var audioCaptureGeneration = 0L
  private var audioRecord: AudioRecord? = null
  private var audioCaptureThread: Thread? = null
  private var audioNoiseSuppressor: NoiseSuppressor? = null
  private var audioAutomaticGainControl: AutomaticGainControl? = null
  private val voiceAura = VoiceAuraRenderEffect(context)
  private val browserDevTools = BrowserDevToolsBridge(context)
  private val mainHandler = Handler(Looper.getMainLooper())

  init {
    contexts += context
  }

  override fun getName(): String = "CodeWideNative"

  override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
    "localeTag" to (context.resources.configuration.locales[0] ?: Locale.getDefault()).toLanguageTag(),
    "uses24HourClock" to DateFormat.is24HourFormat(context),
  )

  @ReactMethod
  fun openDocument(uriValue: String, mimeType: String?, promise: Promise) {
    try {
      val uri = Uri.parse(uriValue)
      require(uri.scheme == "content") { "Only saved content URIs can be opened" }
      val resolvedMimeType = mimeType?.takeIf { it.isNotBlank() }
        ?: context.contentResolver.getType(uri)
        ?: "*/*"
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, resolvedMimeType)
        clipData = ClipData.newRawUri("CodeWide download", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        // Do not preflight this with PackageManager.resolveActivity(). Android
        // package-visibility filtering can hide a valid document viewer from
        // queries even though startActivity() is allowed to launch it.
        context.startActivity(intent)
      } catch (error: ActivityNotFoundException) {
        throw IllegalStateException("No installed app can open this file", error)
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("OPEN_DOCUMENT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun hashContentDocument(uriValue: String, promise: Promise) {
    thread(name = "CodeWideDocumentHash", isDaemon = true) {
      try {
        val uri = requireContentUri(uriValue)
        val digest = MessageDigest.getInstance("SHA-256")
        var bytes = 0L
        context.contentResolver.openInputStream(uri)?.buffered()?.use { input ->
          val buffer = ByteArray(DOCUMENT_IO_BUFFER_BYTES)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            digest.update(buffer, 0, count)
            bytes += count
          }
        } ?: throw IOException("Unable to open the selected file for reading")
        promise.resolve(documentDigestResult(bytes, digest.digest()))
      } catch (error: Throwable) {
        promise.reject("CONTENT_DOCUMENT_HASH_FAILED", error.message ?: "Could not read the selected file", error)
      }
    }
  }

  @ReactMethod
  fun copyContentDocument(sourceUriValue: String, targetUriValue: String, promise: Promise) {
    thread(name = "CodeWideDocumentCopy", isDaemon = true) {
      try {
        val sourceUri = requireContentUri(sourceUriValue)
        val targetUri = requireContentUri(targetUriValue)
        require(sourceUri != targetUri) { "Source and destination files must be different" }
        val digest = MessageDigest.getInstance("SHA-256")
        var bytes = 0L
        context.contentResolver.openInputStream(sourceUri)?.buffered()?.use { input ->
          context.contentResolver.openOutputStream(targetUri, "w")?.buffered()?.use { output ->
            val buffer = ByteArray(DOCUMENT_IO_BUFFER_BYTES)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              if (count == 0) continue
              output.write(buffer, 0, count)
              digest.update(buffer, 0, count)
              bytes += count
            }
            output.flush()
          } ?: throw IOException("Unable to open the selected file for writing")
        } ?: throw IOException("Unable to open the downloaded file for reading")
        promise.resolve(documentDigestResult(bytes, digest.digest()))
      } catch (error: Throwable) {
        promise.reject("CONTENT_DOCUMENT_COPY_FAILED", error.message ?: "Could not save the downloaded file", error)
      }
    }
  }

  @ReactMethod
  fun claimPairing(
    savedServerId: String,
    endpoint: String,
    pairingToken: String,
    deviceName: String,
    tlsPinSha256: String?,
    promise: Promise
  ) {
    try {
      require(savedServerId.isNotBlank()) { "Saved server id is required" }
      validateEndpoint(endpoint)
      require(pairingToken.length in 32..512) { "Pairing token is invalid" }
      require(deviceName.length in 1..80 && !deviceName.any { it.code < 32 || it.code == 127 }) { "Device name is invalid" }
      val identityPin = requireNotNull(tlsPinSha256) { "Secure pairing requires a Companion identity pin" }
      PinnedTls.requireTransport(endpoint, identityPin)
      val innerClaimUrl = endpoint
        .replaceFirst("wss://", "https://")
        .replaceFirst("ws://", "http://")
        .replace("/v1/sync", "/v1/auth")
      val claimUrl = InnerTlsTransport.url(endpoint, innerClaimUrl)
      val publicKeySpki = DeviceKeyStore.publicKeySpki(savedServerId)
      val requestBody = JSONObject()
        .put("action", "register")
        .put("pairingToken", pairingToken)
        .put("deviceName", deviceName)
        .put("publicKeySpki", publicKeySpki)
        .put("proof", DeviceKeyStore.signPairingClaim(savedServerId, pairingToken, deviceName, publicKeySpki))
        .toString()
        .toRequestBody(JSON_MEDIA_TYPE)
      val request = Request.Builder().url(claimUrl).post(requestBody).build()
      val client = InnerTlsTransport.bootstrapClient(pairingHttpClient, endpoint, identityPin)
      client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
          promise.reject("PAIRING_NETWORK_FAILED", "Secure pairing connection failed", error)
        }

        override fun onResponse(call: Call, response: Response) {
          response.use {
            val responseText = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
              promise.reject("PAIRING_REJECTED", "Pairing failed (${it.code}). Generate a fresh one-time token on the host.")
              return
            }
            try {
              val body = JSONObject(responseText)
              val claimedDeviceId = body.getString("deviceId")
              val capabilityToken = body.getString("capabilityToken")
              require(claimedDeviceId.matches(Regex("^device-[a-f0-9]{64}$"))) { "Pairing response device id is invalid" }
              require(capabilityToken.length in 32..512) { "Pairing response capability is invalid" }
              promise.resolve(Arguments.createMap().apply {
                putString("deviceId", claimedDeviceId)
                putString("capabilityToken", capabilityToken)
              })
            } catch (error: Throwable) {
              promise.reject("PAIRING_RESPONSE_INVALID", "Pairing response is invalid", error)
            }
          }
        }
      })
    } catch (error: Throwable) {
      promise.reject("PAIRING_INPUT_INVALID", error.message, error)
    }
  }

  @ReactMethod
  fun saveConnectionCredentials(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, promise: Promise) {
    saveConnectionCredentials(connectionId, endpoint, token, tlsPinSha256, enabled, null, promise)
  }

  @ReactMethod
  fun saveConnectionCredentialsV2(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, deviceId: String, promise: Promise) {
    saveConnectionCredentials(connectionId, endpoint, token, tlsPinSha256, enabled, deviceId, promise)
  }

  private fun saveConnectionCredentials(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, deviceId: String?, promise: Promise) {
    try {
      validateEndpoint(endpoint)
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val store = NativeSessionCredentialsStore(context)
      val existing = store.get(connectionId)
      val capability = token?.takeIf { it.isNotBlank() } ?: existing?.token
      require(capability != null && capability.length in 32..512) { "Capability token is invalid" }
      PinnedTls.requireTransport(endpoint, tlsPinSha256)
      store.upsert(mergeNativeSessionCredentials(
        existing,
        connectionId,
        endpoint,
        capability,
        tlsPinSha256,
        enabled,
        deviceId,
      ))
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("SAVE_CONNECTION_FAILED", "Could not persist native connection credentials", error)
    }
  }

  @ReactMethod
  fun listConnectionConfigs(promise: Promise) {
    try {
      val result = Arguments.createArray()
      NativeSessionCredentialsStore(context).list().forEach { saved ->
        result.pushMap(Arguments.createMap().apply {
          putString("connectionId", saved.id)
          putString("savedServerId", saved.id)
          putString("endpoint", saved.endpoint)
          putString("tlsPinSha256", saved.innerTlsPinSha256)
          putBoolean("enabled", saved.enabled)
          putString("deviceId", saved.deviceId)
        })
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("LIST_CONNECTION_CONFIGS_FAILED", "Could not read native connection configs", error)
    }
  }

  /** Generation-neutral catalog surface: no endpoint, credential, pin, device id, or tunnel state. */
  @ReactMethod
  fun listSavedServerSummaries(promise: Promise) {
    try {
      val result = Arguments.createArray()
      NativeSessionCredentialsStore(context).list().forEach { saved ->
        result.pushMap(Arguments.createMap().apply {
          putString("savedServerId", saved.id)
          putBoolean("enabled", saved.enabled)
        })
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("LIST_SAVED_SERVERS_FAILED", "Could not read saved server catalog", error)
    }
  }

  @ReactMethod
  fun purgeLegacyDerivedStorage(promise: Promise) {
    try {
      promise.resolve(DerivedStorageCleanup.purgeAfterProfileRecovery(context).toDouble())
    } catch (error: Throwable) {
      promise.reject("DERIVED_STORAGE_CLEANUP_FAILED", "Could not remove obsolete local cache databases", error)
    }
  }

  @ReactMethod
  fun startBrowserDevToolsBridge(promise: Promise) {
    try {
      promise.resolve(Arguments.makeNativeMap(browserDevTools.start()))
    } catch (error: Throwable) {
      promise.reject("BROWSER_DEVTOOLS_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stopBrowserDevToolsBridge() {
    browserDevTools.stop()
  }

  @ReactMethod
  fun startBrowserTracing(promise: Promise) {
    browserDevTools.startTracing(promise)
  }

  @ReactMethod
  fun stopBrowserTracing(promise: Promise) {
    browserDevTools.stopTracing(promise)
  }

  @ReactMethod
  fun deleteConnectionCredentials(connectionId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val service = CodexConnectionService.instance
      if (service != null) service.close(connectionId)
      else {
        NativeSessionCredentialsStore(context).remove(connectionId)
        DeviceKeyStore.delete(connectionId)
        NativeFrameStore(context).deleteConnection(connectionId)
        val store = NativeCommandStore(context)
        try { store.deleteConnection(connectionId) } finally { store.close() }
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("DELETE_CONNECTION_FAILED", "Could not delete native connection", error)
    }
  }

  @ReactMethod
  fun setConnectionEnabled(connectionId: String, enabled: Boolean, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val store = NativeSessionCredentialsStore(context)
      val saved = store.get(connectionId) ?: throw IllegalStateException("Saved native credentials are missing")
      store.upsert(saved.copy(enabled = enabled))
      if (!enabled) {
        CodexConnectionService.instance?.suspend(connectionId)
        promise.resolve(null)
        return
      }
      val intent = Intent(context, CodexConnectionService::class.java).apply {
        action = CodexConnectionService.ACTION_ATTACH
        putExtra(CodexConnectionService.EXTRA_CONNECTION_ID, connectionId)
      }
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("SET_CONNECTION_ENABLED_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun attachSocket(connectionId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val intent = Intent(context, CodexConnectionService::class.java).apply {
        action = CodexConnectionService.ACTION_ATTACH
        putExtra(CodexConnectionService.EXTRA_CONNECTION_ID, connectionId)
      }
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("ATTACH_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun mintStoredSession(connectionId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val saved = NativeSessionCredentialsStore(context).get(connectionId)
        ?: throw IllegalStateException("Saved native credentials are missing")
      require(saved.enabled) { "Connection is disabled" }
      SessionCredentialClient.mint(pairingHttpClient, saved) { result ->
        result.fold(
          onSuccess = { credential ->
            promise.resolve(Arguments.createMap().apply {
              putString("sessionToken", credential.token)
              putDouble("expiresAt", credential.expiresAt.toDouble())
            })
          },
          onFailure = { error -> promise.reject("SESSION_MINT_FAILED", "Could not authorize the remote operation", error) },
        )
      }
    } catch (error: Throwable) {
      promise.reject("SESSION_INPUT_INVALID", error.message, error)
    }
  }

  @ReactMethod
  fun companionHttpOrigin(connectionId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      promise.resolve(service.companionHttpOrigin(connectionId))
    } catch (error: Throwable) {
      promise.reject("COMPANION_HTTP_PROXY_FAILED", "Could not open the pinned companion HTTP transport", error)
    }
  }

  @ReactMethod
  fun acquireAuthenticatedTransportLease(savedServerId: String, promise: Promise) {
    try {
      require(savedServerId.isNotBlank()) { "Saved server id is required" }
      wakeSocket(savedServerId)
      acquireAuthenticatedTransportLeaseWhenReady(
        savedServerId,
        promise,
        SystemClock.uptimeMillis() + AUTHENTICATED_LEASE_SERVICE_TIMEOUT_MS,
      )
    } catch (error: Throwable) {
      promise.reject("AUTHENTICATED_LEASE_UNAVAILABLE", "Could not acquire the authenticated transport lease", error)
    }
  }

  private fun acquireAuthenticatedTransportLeaseWhenReady(savedServerId: String, promise: Promise, deadline: Long) {
    val service = CodexConnectionService.instance
    if (service != null) {
      try {
        promise.resolve(service.acquireAuthenticatedTransportLease(savedServerId))
      } catch (error: Throwable) {
        promise.reject("AUTHENTICATED_LEASE_UNAVAILABLE", "Could not acquire the authenticated transport lease", error)
      }
      return
    }
    if (SystemClock.uptimeMillis() >= deadline) {
      promise.reject(
        "AUTHENTICATED_LEASE_UNAVAILABLE",
        "Connection service did not become ready",
      )
      return
    }
    mainHandler.postDelayed(
      { acquireAuthenticatedTransportLeaseWhenReady(savedServerId, promise, deadline) },
      AUTHENTICATED_LEASE_SERVICE_RETRY_MS,
    )
  }

  @ReactMethod
  fun openAuthenticatedDuplex(leaseHandle: String, channelId: String, purpose: String, promise: Promise) {
    try {
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      service.openAuthenticatedDuplex(leaseHandle, channelId, purpose)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("AUTHENTICATED_CHANNEL_UNAVAILABLE", "Could not open the authenticated channel", error)
    }
  }

  @ReactMethod
  fun sendAuthenticatedDuplex(leaseHandle: String, channelId: String, data: String, promise: Promise) {
    try {
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      service.sendAuthenticatedDuplex(leaseHandle, channelId, data)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("AUTHENTICATED_CHANNEL_SEND_FAILED", "Could not send through the authenticated channel", error)
    }
  }

  @ReactMethod
  fun closeAuthenticatedDuplex(leaseHandle: String, channelId: String, code: Double, reason: String) {
    CodexConnectionService.instance?.closeAuthenticatedDuplex(leaseHandle, channelId, code.toInt(), reason)
  }

  @ReactMethod
  fun authenticatedRequest(leaseHandle: String, purpose: String, input: String, promise: Promise) {
    try {
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      service.authenticatedRequest(leaseHandle, purpose, input) { result ->
        result.fold(
          onSuccess = promise::resolve,
          onFailure = { promise.reject("AUTHENTICATED_REQUEST_FAILED", "Authenticated request failed", it) },
        )
      }
    } catch (error: Throwable) {
      promise.reject("AUTHENTICATED_REQUEST_FAILED", "Authenticated request failed", error)
    }
  }

  @ReactMethod
  fun releaseAuthenticatedTransportLease(leaseHandle: String) {
    CodexConnectionService.instance?.releaseAuthenticatedTransportLease(leaseHandle)
  }

  @ReactMethod
  fun engineRpc(connectionId: String, method: String, paramsJson: String, promise: Promise) {
    if (connectionId.isBlank() || method.isBlank() || method.length > 200 || paramsJson.length > MAX_ENGINE_ARGUMENT_BYTES) {
      promise.reject("ENGINE_RPC_INPUT", "Invalid native engine RPC input")
      return
    }
    val params = try {
      JSONTokener(paramsJson).nextValue()
    } catch (error: Throwable) {
      promise.reject("ENGINE_RPC_INPUT", "Native engine RPC params are invalid", error)
      return
    }
    val service = CodexConnectionService.instance
    if (service == null) {
      promise.resolve(engineFailure("Connection service is not running", null))
      return
    }
    service.rpc(connectionId, method, params) { result ->
      result.fold(
        onSuccess = { value -> promise.resolve(JSONObject().put("ok", true).put("result", value ?: JSONObject.NULL).toString()) },
        onFailure = { error -> promise.resolve(engineFailure(error.message ?: "Remote operation failed", (error as? NativeRpcException)?.rpcCode)) },
      )
    }
  }

  @ReactMethod
  fun engineEnqueueCommand(
    connectionId: String,
    commandId: String,
    method: String,
    paramsJson: String,
    promise: Promise,
  ) {
    if (
      connectionId.isBlank() ||
      !commandId.matches(Regex("^[A-Za-z0-9._:-]{1,160}$")) ||
      !NativeCommandPolicy.accepts(method) ||
      paramsJson.length > MAX_ENGINE_ARGUMENT_BYTES
    ) {
      promise.reject("ENGINE_COMMAND_INPUT", "Invalid native durable command input")
      return
    }
    try {
      val params = JSONTokener(paramsJson).nextValue()
      require(params is JSONObject) { "Native durable command params must be an object" }
      val service = CodexConnectionService.instance
      val command = if (service != null) {
        service.enqueueCommand(connectionId, commandId, method, paramsJson)
      } else {
        val credentials = NativeSessionCredentialsStore(context).list()
        require(credentials.any { it.id == connectionId }) { "Connection is not enabled" }
        val store = NativeCommandStore(context)
        val stored = try {
          store.enqueue(connectionId, commandId, method, paramsJson)
        } finally {
          store.close()
        }
        val intent = Intent(context, CodexConnectionService::class.java).apply {
          action = CodexConnectionService.ACTION_WAKE
          putExtra(CodexConnectionService.EXTRA_CONNECTION_ID, connectionId)
        }
        ContextCompat.startForegroundService(context, intent)
        stored
      }
      promise.resolve(JSONObject()
        .put("ok", true)
        .put("result", JSONObject().put("commandId", command.commandId).put("state", command.state))
        .toString())
    } catch (error: Throwable) {
      promise.reject("ENGINE_COMMAND_PERSIST_FAILED", error.message ?: "Could not persist native command", error)
    }
  }

  @ReactMethod
  fun engineListCommands(promise: Promise) {
    try {
      val service = CodexConnectionService.instance
      val rows = if (service != null) service.listCommands() else {
        val store = NativeCommandStore(context)
        try {
          store.list()
        } finally {
          store.close()
        }
      }
      val data = org.json.JSONArray()
      for (command in rows) {
        data.put(JSONObject(NativeCommandStore.projectionJson(command)))
      }
      promise.resolve(JSONObject().put("ok", true).put("result", data).toString())
    } catch (error: Throwable) {
      promise.reject("ENGINE_COMMAND_LIST_FAILED", error.message ?: "Could not read native commands", error)
    }
  }

  @ReactMethod
  fun engineRetryCommand(connectionId: String, commandId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      require(commandId.isNotBlank()) { "Command id is required" }
      val service = CodexConnectionService.instance
      val command = if (service != null) service.retryCommand(connectionId, commandId) else {
        val store = NativeCommandStore(context)
        val retried = try {
          store.retryFailed(connectionId, commandId)
        } finally {
          store.close()
        }
        val intent = Intent(context, CodexConnectionService::class.java).apply {
          action = CodexConnectionService.ACTION_WAKE
          putExtra(CodexConnectionService.EXTRA_CONNECTION_ID, connectionId)
        }
        ContextCompat.startForegroundService(context, intent)
        retried
      }
      promise.resolve(JSONObject()
        .put("ok", true)
        .put("result", JSONObject(NativeCommandStore.projectionJson(command)))
        .toString())
    } catch (error: Throwable) {
      promise.reject("ENGINE_COMMAND_RETRY_FAILED", error.message ?: "Could not retry native command", error)
    }
  }

  @ReactMethod
  fun engineAcknowledgeCommandReceipt(connectionId: String, commandId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      require(commandId.isNotBlank()) { "Command id is required" }
      val service = CodexConnectionService.instance
      if (service != null) service.acknowledgeCommandReceipt(connectionId, commandId)
      else {
        val store = NativeCommandStore(context)
        try {
          store.acknowledgeDeliveryReceipt(connectionId, commandId)
        } finally {
          store.close()
        }
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("ENGINE_COMMAND_RECEIPT_ACK_FAILED", error.message ?: "Could not acknowledge native command receipt", error)
    }
  }

  @ReactMethod
  fun resetSocket(connectionId: String, reason: String) {
    CodexConnectionService.instance?.reset(connectionId, reason.take(120))
  }

  @ReactMethod
  fun wakeSocket(connectionId: String) {
    val service = CodexConnectionService.instance
    if (service != null) {
      service.wake(connectionId)
      return
    }
    // Android may reclaim the sticky service before delivering its restart.
    // Starting it here restores persisted sessions before applying the wake.
    val intent = Intent(context, CodexConnectionService::class.java).apply {
      action = CodexConnectionService.ACTION_WAKE
      putExtra(CodexConnectionService.EXTRA_CONNECTION_ID, connectionId)
    }
    ContextCompat.startForegroundService(context, intent)
  }

  @ReactMethod
  fun listPortForwards(connectionId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val rows = CodexConnectionService.instance?.listPortForwards(connectionId)
        ?: NativePortForwardStore(context).list(connectionId).map { PortForwardProjection(it, null, "stopped", null) }
      val values = org.json.JSONArray()
      rows.forEach { values.put(it.json()) }
      promise.resolve(values.toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_LIST_FAILED", error.message ?: "Could not list port forwards", error)
    }
  }

  @ReactMethod
  fun discoverPorts(connectionId: String, promise: Promise) {
    if (connectionId.isBlank()) {
      promise.reject("PORT_DISCOVERY_INPUT", "Connection id is required")
      return
    }
    thread(name = "CodeWidePortDiscovery", isDaemon = true) {
      try {
        val service = CodexConnectionService.instance ?: error("Server connection is not ready")
        promise.resolve(service.discoverPorts(connectionId))
      } catch (error: Throwable) {
        promise.reject("PORT_DISCOVERY_FAILED", error.message ?: "Could not discover open ports", error)
      }
    }
  }

  @ReactMethod
  fun upsertPortForward(
    connectionId: String,
    profileId: String,
    label: String,
    remotePort: Double,
    preferredLocalPort: Double?,
    serviceKey: String?,
    preference: String,
    promise: Promise,
  ) {
    try {
      val remote = remotePort.toInt()
      val preferred = preferredLocalPort?.toInt()
      require(remotePort == remote.toDouble()) { "Remote port is invalid" }
      require(preferredLocalPort == null || preferredLocalPort == preferred?.toDouble()) { "Local port is invalid" }
      require(serviceKey == null || serviceKey.matches(Regex("^[a-f0-9]{64}$"))) { "Service key is invalid" }
      require(preference in setOf("automatic", "included", "excluded")) { "Forwarding preference is invalid" }
      val service = CodexConnectionService.instance
      val result = if (service != null) {
        service.upsertPortForward(connectionId, profileId, label, remote, preferred, serviceKey, preference)
      } else {
        val store = NativePortForwardStore(context)
        val previous = store.get(profileId)
        require(previous == null || previous.connectionId == connectionId) { "Port forward belongs to another server" }
        val profile = store.upsert(
          StoredPortForward(
            profileId,
            connectionId,
            label.trim(),
            remote,
            preferred,
            serviceKey,
            preference,
            preference != "excluded" && (previous?.enabled ?: false),
            System.currentTimeMillis(),
          ),
        )
        PortForwardProjection(profile, null, "stopped", null)
      }
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_SAVE_FAILED", error.message ?: "Could not save port forward", error)
    }
  }

  @ReactMethod
  fun startPortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance
      val result = if (service != null) service.startPortForward(profileId) else {
        val store = NativePortForwardStore(context)
        val profile = store.setEnabled(profileId, true) ?: error("Port forward not found")
        ContextCompat.startForegroundService(context, Intent(context, CodexConnectionService::class.java).apply {
          action = CodexConnectionService.ACTION_START_PORT_FORWARD
          putExtra(CodexConnectionService.EXTRA_PORT_FORWARD_ID, profileId)
        })
        PortForwardProjection(profile, null, "connecting", null)
      }
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_START_FAILED", error.message ?: "Could not start port forward", error)
    }
  }

  @ReactMethod
  fun stopPortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance
      val result = if (service != null) service.stopPortForward(profileId) else {
        val profile = NativePortForwardStore(context).setEnabled(profileId, false) ?: error("Port forward not found")
        PortForwardProjection(profile, null, "stopped", null)
      }
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_STOP_FAILED", error.message ?: "Could not stop port forward", error)
    }
  }

  @ReactMethod
  fun removePortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance
      if (service != null) service.removePortForward(profileId) else NativePortForwardStore(context).remove(profileId)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_REMOVE_FAILED", error.message ?: "Could not remove port forward", error)
    }
  }

  @ReactMethod
  fun openTerminal(sessionId: String, connectionId: String, threadId: String, cwd: String?, cols: Double, rows: Double, promise: Promise) {
    try {
      val columns = cols.toInt()
      val lines = rows.toInt()
      require(cols == columns.toDouble() && rows == lines.toDouble()) { "Terminal size is invalid" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      service.openTerminal(sessionId, connectionId, threadId, cwd, columns, lines)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("TERMINAL_OPEN_FAILED", error.message ?: "Could not open terminal", error)
    }
  }

  @ReactMethod
  fun writeTerminal(sessionId: String, base64: String, promise: Promise) {
    try {
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      service.writeTerminal(sessionId, base64)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("TERMINAL_WRITE_FAILED", error.message ?: "Could not write to terminal", error)
    }
  }

  @ReactMethod
  fun resizeTerminal(sessionId: String, cols: Double, rows: Double, promise: Promise) {
    try {
      val columns = cols.toInt()
      val lines = rows.toInt()
      require(cols == columns.toDouble() && rows == lines.toDouble()) { "Terminal size is invalid" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      service.resizeTerminal(sessionId, columns, lines)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("TERMINAL_RESIZE_FAILED", error.message ?: "Could not resize terminal", error)
    }
  }

  @ReactMethod
  fun readTerminalOutput(sessionId: String, offset: Double, maxBytes: Double, promise: Promise) {
    try {
      val outputOffset = offset.toLong()
      val outputLimit = maxBytes.toInt()
      require(offset == outputOffset.toDouble() && maxBytes == outputLimit.toDouble()) { "Terminal output range is invalid" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      promise.resolve(service.readTerminalOutput(sessionId, outputOffset, outputLimit))
    } catch (error: Throwable) {
      promise.reject("TERMINAL_READ_FAILED", error.message ?: "Could not read terminal output", error)
    }
  }

  @ReactMethod
  fun closeTerminal(sessionId: String) {
    CodexConnectionService.instance?.closeTerminal(sessionId)
  }

  @ReactMethod
  fun acknowledgeProjection(connectionId: String, projectionCursor: Double) {
    CodexConnectionService.instance?.acknowledgeThrough(connectionId, projectionCursor.toLong())
  }

  @ReactMethod
  fun readCommittedFrames(connectionId: String, afterCursor: Double?, promise: Promise) {
    try {
      val cursor = afterCursor?.toLong()
      require(afterCursor == null || afterCursor == cursor?.toDouble()) { "Projection cursor is invalid" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      service.readCommittedFrames(connectionId, cursor, MAX_COMMITTED_FRAME_PAGE, MAX_COMMITTED_FRAME_BYTES) { result ->
        result.fold(onSuccess = { page ->
          val frames = Arguments.createArray()
          page.frames.forEach { frame ->
            frames.pushMap(Arguments.createMap().apply {
              putDouble("cursor", frame.cursor.toDouble())
              putString("payload", frame.payload)
            })
          }
          promise.resolve(Arguments.createMap().apply {
            page.baseCursor?.let { putDouble("baseCursor", it.toDouble()) }
            page.headCursor?.let { putDouble("headCursor", it.toDouble()) }
            putArray("frames", frames)
          })
        }, onFailure = { error ->
          promise.reject("JOURNAL_READ_FAILED", error.message ?: "Could not read committed frames", error)
        })
      }
    } catch (error: Throwable) {
      promise.reject("JOURNAL_READ_FAILED", error.message ?: "Could not read committed frames", error)
    }
  }

  @Deprecated("Use acknowledgeProjection; frame ids are transport-internal")
  @ReactMethod
  fun acknowledgeFrames(connectionId: String, frameId: Double) {
    // Kept for one native/OTA compatibility window. Old JavaScript cannot
    // safely advance the domain projection because frame ids are not cursors.
  }

  @ReactMethod
  fun startVoiceInput(localeTag: String?, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    context.runOnUiQueueThread {
      try {
        val generation = ++voiceGeneration
        speechRecognizer?.cancel()
        speechRecognizer?.destroy()
        // `isOnDeviceRecognitionAvailable` only says that an engine exists; it
        // does not guarantee that the user's current language pack is present.
        // Selecting it eagerly makes startListening fail immediately on many
        // devices. Let Android's configured recognition service pick the best
        // local/network engine instead.
        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
        speechRecognizer = recognizer
        recognizer.setRecognitionListener(VoiceListener(generation, recognizer))
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag ?: Locale.getDefault().toLanguageTag())
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1_500L)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1_200L)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1_800L)
        }
        recognizer.startListening(intent)
        promise.resolve(null)
      } catch (error: Throwable) {
        voiceGeneration += 1
        speechRecognizer?.cancel()
        speechRecognizer?.destroy()
        speechRecognizer = null
        promise.reject("VOICE_START_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun stopVoiceInput() {
    context.runOnUiQueueThread {
      voiceGeneration += 1
      speechRecognizer?.cancel()
      speechRecognizer?.destroy()
      speechRecognizer = null
    }
  }

  /** Drives the live root-View RuntimeShader used while the microphone is recording. */
  @ReactMethod
  fun setVoiceAuraState(active: Boolean, level: Double, reducedMotion: Boolean) {
    context.runOnUiQueueThread {
      try {
        voiceAura.update(active, level, reducedMotion)
      } catch (error: Throwable) {
        voiceAura.clear()
        Log.e(VOICE_AURA_LOG_TAG, "Could not update live voice aura", error)
      }
    }
  }

  /** Moves the live shader into the separate Android window owned by a React Native Modal. */
  @ReactMethod
  fun setVoiceAuraTarget(reactTag: Double?) {
    context.runOnUiQueueThread {
      try {
        val tag = reactTag?.toInt()?.takeIf { it > 0 }
        val view = tag?.let {
          UIManagerHelper.getUIManagerForReactTag(context, it)?.resolveView(it) as? View
        }
        voiceAura.setTarget(view)
      } catch (error: Throwable) {
        voiceAura.setTarget(null)
        Log.e(VOICE_AURA_LOG_TAG, "Could not update live voice aura target", error)
      }
    }
  }

  /** Records mono PCM16 frames. Transcription stays on the paired Codex host. */
  @ReactMethod
  fun startPcmCapture(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    try {
      stopPcmCaptureInternal()
      val capture = openPcmCapture()
      val recorder = capture.recorder
      val sampleRate = capture.sampleRate
      val noiseSuppressor = capture.noiseSuppressor
      val automaticGainControl = capture.automaticGainControl
      val generation = synchronized(this) {
        audioCaptureGeneration += 1
        audioCaptureRunning = true
        audioRecord = recorder
        audioNoiseSuppressor = noiseSuppressor
        audioAutomaticGainControl = automaticGainControl
        audioCaptureGeneration
      }
      Log.i(
        AUDIO_LOG_TAG,
        "PCM capture source=${capture.source.label} sampleRate=$sampleRate channels=${recorder.channelCount} " +
          "bufferFrames=${recorder.bufferSizeInFrames} ns=${noiseSuppressor?.enabled ?: false} " +
          "agc=${automaticGainControl?.enabled ?: false}",
      )
      audioCaptureThread = thread(name = "CodeWidePcmCapture", isDaemon = true) {
        capturePcm(generation, recorder, sampleRate, noiseSuppressor, automaticGainControl)
      }
      promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", sampleRate)
        putString("source", capture.source.label)
        putBoolean("noiseSuppressor", noiseSuppressor?.enabled ?: false)
        putBoolean("automaticGainControl", automaticGainControl?.enabled ?: false)
      })
    } catch (error: Throwable) {
      stopPcmCaptureInternal()
      promise.reject("PCM_CAPTURE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stopPcmCapture() {
    stopPcmCaptureInternal()
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    contexts -= context
    browserDevTools.close()
    stopPcmCaptureInternal()
    context.runOnUiQueueThread {
      voiceAura.clear()
      voiceGeneration += 1
      speechRecognizer?.cancel()
      speechRecognizer?.destroy()
      speechRecognizer = null
    }
    super.invalidate()
  }

  private fun capturePcm(
    generation: Long,
    recorder: AudioRecord,
    sampleRate: Int,
    noiseSuppressor: NoiseSuppressor?,
    automaticGainControl: AutomaticGainControl?,
  ) {
    val samples = ShortArray(maxOf(1, sampleRate / AUDIO_CHUNKS_PER_SECOND))
    try {
      emitPcm("started", null, sampleRate, 0, 0.0)
      while (audioCaptureRunning && generation == audioCaptureGeneration) {
        val count = recorder.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
        if (count <= 0) {
          if (audioCaptureRunning) emitPcm("error", "read_$count", sampleRate, 0, 0.0)
          break
        }
        val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
        var energy = 0.0
        for (index in 0 until count) {
          val sample = samples[index]
          bytes.putShort(sample)
          val normalized = sample.toDouble() / Short.MAX_VALUE.toDouble()
          energy += normalized * normalized
        }
        emitPcm(
          "chunk",
          Base64.encodeToString(bytes.array(), Base64.NO_WRAP),
          sampleRate,
          count,
          sqrt(energy / count.toDouble()).coerceIn(0.0, 1.0),
        )
      }
    } catch (error: Throwable) {
      if (audioCaptureRunning && generation == audioCaptureGeneration) {
        emitPcm("error", error.javaClass.simpleName, sampleRate, 0, 0.0)
      }
    } finally {
      synchronized(this) {
        if (generation == audioCaptureGeneration) {
          audioCaptureRunning = false
          audioRecord = null
          audioCaptureThread = null
          audioNoiseSuppressor = null
          audioAutomaticGainControl = null
        }
      }
      try { recorder.stop() } catch (_: Throwable) {}
      noiseSuppressor?.release()
      automaticGainControl?.release()
      recorder.release()
      emitPcm("stopped", null, sampleRate, 0, 0.0)
    }
  }

  private fun stopPcmCaptureInternal() {
    val recorder = synchronized(this) {
      audioCaptureRunning = false
      audioCaptureGeneration += 1
      val active = audioRecord
      audioRecord = null
      active
    }
    try { recorder?.stop() } catch (_: Throwable) {}
  }

  private inner class VoiceListener(
    private val generation: Long,
    private val recognizer: SpeechRecognizer,
  ) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = emitVoice("ready", null)
    override fun onBeginningOfSpeech() = emitVoice("speechStart", null)
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = emitVoice("speechEnd", null)
    override fun onError(error: Int) = finishVoice(generation, recognizer, "error", voiceErrorName(error))
    override fun onPartialResults(partialResults: Bundle?) = emitVoice("partial", firstResult(partialResults))
    override fun onResults(results: Bundle?) = finishVoice(generation, recognizer, "final", firstResult(results))
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
  }

  private fun finishVoice(generation: Long, recognizer: SpeechRecognizer, type: String, text: String?) {
    if (generation != voiceGeneration || speechRecognizer !== recognizer) return
    emitVoice(type, text)
    speechRecognizer = null
    recognizer.destroy()
  }

  private fun firstResult(bundle: Bundle?): String? =
    bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  private fun voiceErrorName(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "audio"
    SpeechRecognizer.ERROR_CLIENT -> "client"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
    SpeechRecognizer.ERROR_NETWORK -> "network"
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network_timeout"
    SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
    SpeechRecognizer.ERROR_SERVER -> "server"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech_timeout"
    else -> "code_$error"
  }

  private fun emitVoice(type: String, text: String?) {
    val map = Arguments.createMap().apply {
      putString("type", type)
      if (text != null) putString("text", text)
    }
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(VOICE_EVENT, map)
      }
    }
  }

  private fun emitPcm(type: String, data: String?, sampleRate: Int, samplesPerChannel: Int, level: Double) {
    val map = Arguments.createMap().apply {
      putString("type", type)
      if (type == "chunk") {
        putString("data", data)
        putInt("sampleRate", sampleRate)
        putInt("numChannels", 1)
        putInt("samplesPerChannel", samplesPerChannel)
        putDouble("level", level)
      } else if (data != null) {
        putString("error", data)
      }
    }
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(AUDIO_EVENT, map)
      }
    }
  }

  private fun openPcmCapture(): PcmCaptureSession {
    val failures = mutableListOf<String>()
    for (source in AUDIO_CAPTURE_SOURCES) {
      var recorder: AudioRecord? = null
      var noiseSuppressor: NoiseSuppressor? = null
      var automaticGainControl: AutomaticGainControl? = null
      try {
        val recorderBuilder = AudioRecord.Builder()
          .setAudioSource(source.value)
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
              // Let Android select the native routed-input rate instead of
              // resampling every microphone frame to a hard-coded rate.
              .build(),
          )
          .setBufferSizeInBytes(AUDIO_CAPTURE_BUFFER_BYTES)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          recorderBuilder.setPrivacySensitive(true)
        }
        recorder = recorderBuilder.build()
        require(recorder.state == AudioRecord.STATE_INITIALIZED) { "Microphone could not be initialized" }
        val sampleRate = recorder.sampleRate
        require(sampleRate in 8_000..96_000) { "Android returned an unsupported microphone sample rate" }
        noiseSuppressor = createNoiseSuppressor(recorder.audioSessionId)
        automaticGainControl = createAutomaticGainControl(recorder.audioSessionId)
        // Several Android vendors accept an AudioSource in Builder.build()
        // and reject it only here. Treat startRecording as capability probing
        // so one unsupported processing path cannot disable dictation.
        recorder.startRecording()
        return PcmCaptureSession(recorder, source, sampleRate, noiseSuppressor, automaticGainControl)
      } catch (error: Throwable) {
        failures += "${source.label}:${error.javaClass.simpleName}"
        Log.w(AUDIO_LOG_TAG, "PCM capture source ${source.label} unavailable; trying fallback", error)
        noiseSuppressor?.release()
        automaticGainControl?.release()
        try {
          recorder?.release()
        } catch (_: Throwable) {
          // A partially constructed vendor AudioRecord can reject release.
        }
      }
    }
    throw IllegalStateException("No supported microphone capture source (${failures.joinToString()})")
  }

  private fun createNoiseSuppressor(audioSessionId: Int): NoiseSuppressor? = try {
    if (!NoiseSuppressor.isAvailable()) null else NoiseSuppressor.create(audioSessionId)?.also { effect ->
      if (effect.hasControl()) effect.enabled = true
    }
  } catch (error: Throwable) {
    Log.w(AUDIO_LOG_TAG, "NoiseSuppressor unavailable for this capture session", error)
    null
  }

  private fun createAutomaticGainControl(audioSessionId: Int): AutomaticGainControl? = try {
    if (!AutomaticGainControl.isAvailable()) null else AutomaticGainControl.create(audioSessionId)?.also { effect ->
      if (effect.hasControl()) effect.enabled = true
    }
  } catch (error: Throwable) {
    Log.w(AUDIO_LOG_TAG, "AutomaticGainControl unavailable for this capture session", error)
    null
  }

  private fun validateEndpoint(endpoint: String) {
    val uri = URI(endpoint)
    require(uri.scheme == "wss" || uri.scheme == "ws") { "Endpoint must use ws or wss" }
    require(uri.path == "/v1/sync") { "Endpoint path must be /v1/sync" }
    require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
      "Endpoint must not contain credentials, query parameters, or fragments"
    }
    if (uri.scheme == "ws") {
      require(uri.host == "127.0.0.1" || uri.host == "localhost" || uri.host == "[::1]" || uri.host == "10.0.2.2") {
        "Cleartext WebSocket is only allowed for local development"
      }
    }
  }

  private fun requireContentUri(value: String): Uri = Uri.parse(value).also { uri ->
    require(uri.scheme == "content") { "Only Storage Access Framework content URIs are supported" }
  }

  private fun documentDigestResult(bytes: Long, digest: ByteArray) = Arguments.createMap().apply {
    putDouble("bytes", bytes.toDouble())
    putString("sha256", digest.joinToString("") { byte -> "%02x".format(Locale.ROOT, byte.toInt() and 0xff) })
  }

  companion object {
    const val ENGINE_EVENT = "CodeWideEngineEvent"
    const val VOICE_EVENT = "CodeWideVoiceEvent"
    const val AUDIO_EVENT = "CodeWideAudioEvent"
    const val PORT_FORWARD_EVENT = "CodeWidePortForwardEvent"
    const val TERMINAL_EVENT = "CodeWideTerminalEvent"
    const val AUTHENTICATED_TRANSPORT_EVENT = "CodeWideAuthenticatedTransportEvent"
    // Native capture frames are intentionally smaller than network batches.
    // A 250 ms first frame makes a normal tap-to-stop recording observable
    // without turning each callback into its own remote request; JavaScript
    // still coalesces these into one-second appendBatch RPCs.
    private const val AUDIO_CHUNKS_PER_SECOND = 4
    // 200 ms of mono PCM16 at 96 kHz. AudioRecord may internally enlarge it;
    // this is intentionally above the usual 48 kHz route minimum so capture
    // remains smooth while the JS bridge handles the previous chunk.
    private const val AUDIO_CAPTURE_BUFFER_BYTES = 38_400
    private const val AUDIO_LOG_TAG = "CodeWideAudio"
    private const val VOICE_AURA_LOG_TAG = "CodeWideVoiceAura"
    // Prefer the processed communication path for stable speech level, but
    // vendor support is not uniform. Recognition and raw mic keep capture
    // working on devices that reject VOICE_COMMUNICATION.
    private val AUDIO_CAPTURE_SOURCES = listOf(
      CaptureSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION, "voice_communication"),
      CaptureSource(MediaRecorder.AudioSource.VOICE_RECOGNITION, "voice_recognition"),
      CaptureSource(MediaRecorder.AudioSource.MIC, "mic"),
    )
    private const val MAX_ENGINE_ARGUMENT_BYTES = 64 * 1024 * 1024
    private const val NATIVE_BRIDGE_CONTRACT_VERSION = 2
    private const val MAX_COMMITTED_FRAME_PAGE = 128
    private const val MAX_COMMITTED_FRAME_BYTES = 512 * 1024
    private const val DOCUMENT_IO_BUFFER_BYTES = 256 * 1024
    private const val AUTHENTICATED_LEASE_SERVICE_RETRY_MS = 25L
    private const val AUTHENTICATED_LEASE_SERVICE_TIMEOUT_MS = 5_000L
    private val contexts = CopyOnWriteArraySet<ReactApplicationContext>()
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    private val pairingHttpClient = OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(15, TimeUnit.SECONDS)
      .retryOnConnectionFailure(false)
      .build()

    fun emitEngineEvent(
      connectionId: String,
      type: String,
      data: String,
      frameId: Long?,
      projectionCursor: Long? = null,
    ) {
      contexts.forEach { reactContext ->
        reactContext.runOnUiQueueThread {
          if (!reactContext.hasActiveReactInstance()) return@runOnUiQueueThread
          val map = Arguments.createMap().apply {
            putInt("contractVersion", NATIVE_BRIDGE_CONTRACT_VERSION)
            putString("connectionId", connectionId)
            putString("type", type)
            putString("data", data)
            if (frameId != null) putDouble("frameId", frameId.toDouble())
            if (projectionCursor != null) putDouble("projectionCursor", projectionCursor.toDouble())
          }
          reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(ENGINE_EVENT, map)
        }
      }
    }

    fun emitPortForwardEvent(data: String) {
      contexts.forEach { reactContext ->
        reactContext.runOnUiQueueThread {
          if (!reactContext.hasActiveReactInstance()) return@runOnUiQueueThread
          reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(PORT_FORWARD_EVENT, data)
        }
      }
    }

    fun emitTerminalEvent(data: String) {
      contexts.forEach { reactContext ->
        reactContext.runOnUiQueueThread {
          if (!reactContext.hasActiveReactInstance()) return@runOnUiQueueThread
          reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(TERMINAL_EVENT, data)
        }
      }
    }

    fun emitAuthenticatedTransportEvent(data: String) {
      contexts.forEach { reactContext ->
        reactContext.runOnUiQueueThread {
          if (!reactContext.hasActiveReactInstance()) return@runOnUiQueueThread
          reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(AUTHENTICATED_TRANSPORT_EVENT, data)
        }
      }
    }

    private fun engineFailure(message: String, code: Int?): String = JSONObject()
      .put("ok", false)
      .put("message", message.take(1_000))
      .apply { if (code != null) put("code", code) }
      .toString()
  }
}
