package dev.codewide.app.remote

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioRecord
import android.media.AudioFormat
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
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import dev.codewide.app.rendering.VoiceAuraOverlay
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

class CodeWideModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val microphone = PreparedMicrophone(context)

  private var speechRecognizer: SpeechRecognizer? = null
  private var voiceGeneration = 0L
  @Volatile private var audioCaptureRunning = false
  private var audioCaptureGeneration = 0L
  private var audioCaptureLeasePurpose: String? = null
  private var audioCaptureLeaseToken: String? = null
  private var audioRecord: AudioRecord? = null
  private var audioCaptureThread: Thread? = null
  private val voiceAura = VoiceAuraOverlay(context)
  private val browserDevTools = BrowserDevToolsBridge(context)
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var invalidated = false

  init {
    contexts += context
    context.addLifecycleEventListener(this)
  }

  override fun onHostResume() {
    microphone.setForeground(true)
    refreshMicrophonePermission()
  }

  override fun onHostPause() {
    microphone.setForeground(false)
  }
  override fun onHostDestroy() {
    stopPcmCaptureInternal()
    microphone.setForeground(false)
  }

  @ReactMethod
  fun refreshMicrophonePermission() {
    microphone.refresh()
    if (context.hasActiveReactInstance()) {
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("CodeWideMicrophonePermission", microphone.hasPermission())
    }
  }

  override fun getName(): String = "CodeWideNative"

  override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
    "localeTag" to (context.resources.configuration.locales[0] ?: Locale.getDefault()).toLanguageTag(),
    "uses24HourClock" to DateFormat.is24HourFormat(context),
    "microphonePermissionGranted" to microphone.hasPermission(),
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
  ) = claimPairingWithRelay(savedServerId, endpoint, pairingToken, deviceName, tlsPinSha256, null, promise)

  @ReactMethod
  fun claimRelayPairing(
    savedServerId: String,
    endpoint: String,
    pairingToken: String,
    deviceName: String,
    tlsPinSha256: String?,
    relayRouteId: String,
    relayTlsPinSha256: String,
    promise: Promise
  ) {
    try {
      claimPairingWithRelay(savedServerId, endpoint, pairingToken, deviceName, tlsPinSha256, PinnedRelayRoute(relayRouteId, relayTlsPinSha256), promise)
    } catch (error: Throwable) {
      promise.reject("PAIRING_INPUT_INVALID", error.message, error)
    }
  }

  private fun claimPairingWithRelay(
    savedServerId: String,
    endpoint: String,
    pairingToken: String,
    deviceName: String,
    tlsPinSha256: String?,
    relay: PinnedRelayRoute?,
    promise: Promise
  ) {
    try {
      require(savedServerId.isNotBlank()) { "Saved server id is required" }
      validateConnectionEndpoint(endpoint)
      require(pairingToken.length in 32..512) { "Pairing token is invalid" }
      require(deviceName.length in 1..80 && !deviceName.any { it.code < 32 || it.code == 127 }) { "Device name is invalid" }
      val identityPin = requireNotNull(tlsPinSha256) { "Secure pairing requires a Companion identity pin" }
      PinnedTls.requireTransport(endpoint, identityPin)
      PinnedTls.requireRelayEndpoint(endpoint, relay)
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
      val client = InnerTlsTransport.bootstrapClient(pairingHttpClient, endpoint, identityPin, relay)
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
    saveConnectionCredentials(connectionId, endpoint, token, tlsPinSha256, enabled, null, null, promise)
  }

  @ReactMethod
  fun saveConnectionCredentialsV2(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, deviceId: String, promise: Promise) {
    saveConnectionCredentials(connectionId, endpoint, token, tlsPinSha256, enabled, deviceId, null, promise)
  }

  @ReactMethod
  fun saveConnectionCredentialsV3(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, deviceId: String, relayRouteId: String, relayTlsPinSha256: String, promise: Promise) {
    try {
      saveConnectionCredentials(connectionId, endpoint, token, tlsPinSha256, enabled, deviceId, PinnedRelayRoute(relayRouteId, relayTlsPinSha256), promise)
    } catch (error: Throwable) {
      promise.reject("SAVE_CONNECTION_FAILED", "Could not persist native connection credentials", error)
    }
  }

  private fun saveConnectionCredentials(connectionId: String, endpoint: String, token: String?, tlsPinSha256: String?, enabled: Boolean, deviceId: String?, relay: PinnedRelayRoute?, promise: Promise) {
    try {
      validateConnectionEndpoint(endpoint)
      require(connectionId.isNotBlank()) { "Connection id is required" }
      PinnedTls.requireTransport(endpoint, tlsPinSha256)
      PinnedTls.requireRelayEndpoint(endpoint, relay)
      processNativeAuthorityLifecycle.access {
        val store = NativeSessionCredentialsStore(context)
        val existing = store.get(connectionId)
        val capability = token?.takeIf { it.isNotBlank() } ?: existing?.token
        require(capability != null && capability.length in 32..512) { "Capability token is invalid" }
        val replacement = mergeNativeSessionCredentials(
          existing,
          connectionId,
          endpoint,
          capability,
          tlsPinSha256,
          enabled,
          deviceId,
          relay,
        )
        if (replacement == existing) return@access
        val service = CodexConnectionService.instance
        if (service == null) store.upsert(replacement)
        else service.replaceSavedServerAuthority(replacement)
      }
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
  fun revokeStoredConnection(connectionId: String, promise: Promise) {
    val (store, saved) = try {
      require(connectionId.isNotBlank()) { "Connection id is required" }
      val credentials = NativeSessionCredentialsStore(context)
      val session = requireNotNull(credentials.get(connectionId)) {
        "Saved native credentials are missing"
      }
      credentials to session
    } catch (error: Throwable) {
      promise.reject("REVOKE_CONNECTION_FAILED", "Could not read paired device credentials", error)
      return
    }
    if (saved.revocationConfirmed) {
      promise.resolve(null)
      return
    }
    try {
      val endpoint = URI(saved.endpoint)
      val revokeUrl = URI("https", endpoint.rawAuthority, "/v1/device", null, null).toString()
      val client = InnerTlsTransport.client(pairingHttpClient, saved, "device_revoke")
      val request = Request.Builder()
        .url(revokeUrl)
        .delete()
        .build()
      client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
          promise.reject("REVOKE_CONNECTION_FAILED", "Could not reach Companion to remove this device", error)
        }

        override fun onResponse(call: Call, response: Response) {
          response.use {
            if (it.code == 200) {
              try {
                store.confirmRevocation(connectionId)
                promise.resolve(null)
              } catch (error: Throwable) {
                promise.reject("REVOKE_CONNECTION_FAILED", "Companion removed this device but local confirmation could not be saved", error)
              }
            } else if (it.code == 404) {
              promise.reject("REVOKE_CONNECTION_UNSUPPORTED", "Companion does not support device removal; update Companion")
            } else {
              promise.reject("REVOKE_CONNECTION_FAILED", "Companion rejected device removal (HTTP ${it.code})")
            }
          }
        }
      })
    } catch (error: Throwable) {
      promise.reject("REVOKE_CONNECTION_FAILED", "Could not start Companion device removal", error)
    }
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
      require(!enabled || !saved.revocationConfirmed) { "This device was removed from Companion; pair it again" }
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
  fun engineLiveSubscribe(connectionId: String, channelId: String, threadId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank() && channelId.isNotBlank() && threadId.isNotBlank()) {
        "Live subscription identifiers are required"
      }
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      check(service.subscribeLive(connectionId, channelId, threadId)) {
        "Live subscription is unavailable"
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("ENGINE_LIVE_SUBSCRIBE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun engineLiveUnsubscribe(connectionId: String, channelId: String, promise: Promise) {
    try {
      require(connectionId.isNotBlank() && channelId.isNotBlank()) {
        "Live subscription identifiers are required"
      }
      val service = CodexConnectionService.instance ?: error("Connection service is not running")
      check(service.unsubscribeLive(connectionId, channelId)) {
        "Live subscription is unavailable"
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("ENGINE_LIVE_UNSUBSCRIBE_FAILED", error.message, error)
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
        ?: emptyList()
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
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      val result = service.upsertPortForward(connectionId, profileId, label, remote, preferred, serviceKey, preference)
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_SAVE_FAILED", error.message ?: "Could not save port forward", error)
    }
  }

  @ReactMethod
  fun startPortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      val result = service.startPortForward(profileId)
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_START_FAILED", error.message ?: "Could not start port forward", error)
    }
  }

  @ReactMethod
  fun stopPortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      val result = service.stopPortForward(profileId)
      promise.resolve(result.json().toString())
    } catch (error: Throwable) {
      promise.reject("PORT_FORWARD_STOP_FAILED", error.message ?: "Could not stop port forward", error)
    }
  }

  @ReactMethod
  fun removePortForward(profileId: String, promise: Promise) {
    try {
      require(profileId.isNotBlank()) { "Port forward id is required" }
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      service.removePortForward(profileId)
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
  fun listTerminals(promise: Promise) {
    try {
      val service = CodexConnectionService.instance ?: error("Server connection is not ready")
      promise.resolve(service.listTerminals())
    } catch (error: Throwable) {
      promise.reject("TERMINAL_LIST_FAILED", error.message ?: "Could not list terminals", error)
    }
  }

  @ReactMethod
  fun closeTerminal(sessionId: String) {
    CodexConnectionService.instance?.closeTerminal(sessionId)
  }

  @ReactMethod
  fun startLegacyRuntimeResources(promise: Promise) {
    try {
      microphone.setForeground(context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED)
      microphone.setEnabled(true)
      val service = CodexConnectionService.instance
      if (service != null) {
        service.activateLegacySync()
      } else {
        ContextCompat.startForegroundService(
          context,
          Intent(context, CodexConnectionService::class.java).apply {
            action = CodexConnectionService.ACTION_ATTACH
          },
        )
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("LEGACY_RUNTIME_START_FAILED", error.message ?: "Could not start legacy native resources", error)
    }
  }

  @ReactMethod
  fun stopLegacyRuntimeResources(promise: Promise) {
    try {
      microphone.setEnabled(false)
      CodexConnectionService.instance?.stopLegacyRuntimeResources()
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("LEGACY_RUNTIME_STOP_FAILED", error.message ?: "Could not stop legacy native resources", error)
    }
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
        microphone.setPlatformRecognition(true)
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
        microphone.setPlatformRecognition(false)
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
      microphone.setPlatformRecognition(false)
    }
  }

  /** Drives the application-scoped visual overlay used while the microphone is recording. */
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

  /** Keeps the actual Compose dialog's system bars dark, independently of the Activity. */
  @ReactMethod
  fun configureFullscreenWindow(reactTag: Double) {
    context.runOnUiQueueThread {
      try {
        val tag = reactTag.toInt()
        val view = UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag) as? View
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          view?.windowInsetsController?.setSystemBarsAppearance(
            0,
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
              android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
          )
        }
      } catch (error: Throwable) {
        Log.e("CodeWideFullscreen", "Could not configure fullscreen window", error)
      }
    }
  }

  @ReactMethod
  fun setVoiceAuraOrigin(reactTag: Double?) {
    context.runOnUiQueueThread {
      try {
        val tag = reactTag?.toInt()?.takeIf { it > 0 }
        val view = tag?.let {
          UIManagerHelper.getUIManagerForReactTag(context, it)?.resolveView(it) as? View
        }
        voiceAura.setOrigin(view)
      } catch (error: Throwable) {
        voiceAura.setOrigin(null)
        Log.e(VOICE_AURA_LOG_TAG, "Could not locate voice aura origin", error)
      }
    }
  }

  /** Captures mono PCM16 and emits bandwidth-efficient Opus frames. Transcription stays on the paired Codex host. */
  @ReactMethod
  fun startPcmCapture(token: String, purpose: String, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    if (token.isBlank() || (purpose != "dictation" && purpose != "globalSupervisor")) {
      promise.reject("MIC_LEASE_INVALID", "Microphone lease is invalid")
      return
    }
    val claimed = synchronized(this) {
      if (audioCaptureLeaseToken != null || audioCaptureRunning) {
        false
      } else {
        audioCaptureLeaseToken = token
        audioCaptureLeasePurpose = purpose
        true
      }
    }
    if (!claimed) {
      promise.reject("MIC_BUSY", "Microphone is already in use")
      return
    }
    VoiceCaptureForegroundService.acquire(context, token) foreground@{ error ->
      if (error != null) {
        synchronized(this) {
          if (audioCaptureLeaseToken == token && audioCaptureLeasePurpose == purpose) {
            audioCaptureLeaseToken = null
            audioCaptureLeasePurpose = null
          }
        }
        promise.reject("PCM_CAPTURE_FOREGROUND_FAILED", error.message, error)
        return@foreground
      }
      val stillOwned = synchronized(this) {
        audioCaptureLeaseToken == token && audioCaptureLeasePurpose == purpose
      }
      if (!stillOwned) {
        VoiceCaptureForegroundService.release(token)
        promise.reject("PCM_CAPTURE_CANCELLED", "Microphone capture start was cancelled")
        return@foreground
      }
      thread(name = "CodeWidePcmStart", isDaemon = true) {
        beginPcmCapture(token, purpose, promise)
      }
    }
  }

  private fun beginPcmCapture(token: String, purpose: String, promise: Promise) {
    var capture: PreparedMicrophone.Session? = null
    var captureOwnedByThread = false
    try {
      val activeCapture = microphone.start()
      capture = activeCapture
      val recorder = activeCapture.recorder
      val sampleRate = activeCapture.sampleRate
      val effects = activeCapture.effects
      val generation = synchronized(this) {
        check(audioCaptureLeaseToken == token && audioCaptureLeasePurpose == purpose) {
          "Microphone capture start was cancelled"
        }
        audioCaptureGeneration += 1
        audioCaptureRunning = true
        audioRecord = recorder
        audioCaptureGeneration
      }
      Log.i(
        AUDIO_LOG_TAG,
        "PCM capture source=${activeCapture.source.label} sampleRate=$sampleRate channels=${recorder.channelCount} " +
          "bufferFrames=${recorder.bufferSizeInFrames} aecSupported=${effects.acousticEchoCancelerSupported} " +
          "aec=${effects.acousticEchoCancelerEnabled} ns=${effects.noiseSuppressor?.enabled == true} " +
          "agc=${effects.automaticGainControl?.enabled == true}",
      )
      val captureThread = thread(
        start = false,
        name = "CodeWideAudioCapture",
        isDaemon = true,
      ) {
        capturePcm(generation, purpose, activeCapture)
      }
      synchronized(this) { audioCaptureThread = captureThread }
      captureThread.start()
      captureOwnedByThread = true
      promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", sampleRate)
        putString("source", activeCapture.source.label)
        putBoolean("acousticEchoCancelerSupported", effects.acousticEchoCancelerSupported)
        putBoolean("acousticEchoCancelerEnabled", effects.acousticEchoCancelerEnabled)
        putBoolean("noiseSuppressor", effects.noiseSuppressor?.enabled == true)
        putBoolean("automaticGainControl", effects.automaticGainControl?.enabled == true)
      })
    } catch (error: Throwable) {
      if (!captureOwnedByThread) {
        capture?.let { abandoned ->
          synchronized(this) {
            if (audioRecord === abandoned.recorder) {
              audioCaptureRunning = false
              audioRecord = null
              audioCaptureThread = null
            }
          }
          try { abandoned.recorder.stop() } catch (_: Throwable) {}
          try {
            abandoned.release()
          } catch (cleanupError: Throwable) {
            Log.w(AUDIO_LOG_TAG, "PCM capture startup cleanup failed", cleanupError)
          } finally {
            microphone.captureReleased()
          }
        }
      }
      stopPcmCaptureInternal()
      promise.reject("PCM_CAPTURE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stopPcmCapture(token: String, purpose: String, promise: Promise) {
    val matches = synchronized(this) {
      audioCaptureLeaseToken == token && audioCaptureLeasePurpose == purpose
    }
    if (!matches) {
      promise.reject("MIC_LEASE_STALE", "Microphone lease is stale")
      return
    }
    stopPcmCaptureInternal()
    promise.resolve(null)
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    stopPcmCaptureInternal()
    microphone.close()
    mainHandler.removeCallbacksAndMessages(null)
    contexts -= context
    browserDevTools.close()
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
    purpose: String,
    capture: PreparedMicrophone.Session,
  ) {
    val recorder = capture.recorder
    val sampleRate = capture.sampleRate
    val samples = ShortArray(maxOf(1, sampleRate / OPUS_FRAMES_PER_SECOND))
    val batcher = OpusTransportBatcher(maxOf(1, sampleRate / AUDIO_CHUNKS_PER_SECOND))
    var encoder: OpusAudioEncoder? = null
    try {
      val activeEncoder = if (purpose == "dictation") OpusAudioEncoder(sampleRate, 1, OPUS_BITRATE) else null
      encoder = activeEncoder
      emitPcm("started", null, sampleRate, 0, 0.0)
      while (audioCaptureRunning && generation == audioCaptureGeneration) {
        val count = recorder.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
        if (count <= 0) {
          if (audioCaptureRunning) emitPcm("error", "read_$count", sampleRate, 0, 0.0)
          break
        }
        var energy = 0.0
        for (index in 0 until count) {
          val sample = samples[index]
          val normalized = sample.toDouble() / Short.MAX_VALUE.toDouble()
          energy += normalized * normalized
        }
        val level = sqrt(energy / count.toDouble()).coerceIn(0.0, 1.0)
        // The visual envelope follows PCM frames, not transport batches or JS scheduling.
        context.runOnUiQueueThread {
          if (audioCaptureRunning && generation == audioCaptureGeneration) voiceAura.setLevel(level)
        }
        if (activeEncoder == null) {
          emitRawPcm(samples, count, sampleRate, level)
        } else {
          for (packet in activeEncoder.append(samples, count)) {
            batcher.append(packet, level)?.let { emitOpus(it, sampleRate) }
          }
        }
      }
    } catch (error: Throwable) {
      if (audioCaptureRunning && generation == audioCaptureGeneration) {
        emitPcm("error", error.javaClass.simpleName, sampleRate, 0, 0.0)
      }
    } finally {
      try {
        encoder?.let { activeEncoder ->
          for (packet in activeEncoder.finish()) {
            batcher.append(packet, 0.0)?.let { emitOpus(it, sampleRate) }
          }
        }
        batcher.flush()?.let { emitOpus(it, sampleRate) }
      } catch (error: Throwable) {
        encoder?.close()
        if (audioCaptureRunning && generation == audioCaptureGeneration) {
          emitPcm("error", error.javaClass.simpleName, sampleRate, 0, 0.0)
        }
      }
      val captureToken = synchronized(this) {
        if (generation == audioCaptureGeneration) {
          val token = audioCaptureLeaseToken
          audioCaptureRunning = false
          audioRecord = null
          audioCaptureThread = null
          audioCaptureLeaseToken = null
          audioCaptureLeasePurpose = null
          token
        } else null
      }
      try { recorder.stop() } catch (_: Throwable) {}
      try {
        capture.release()
      } finally {
        microphone.captureReleased()
        captureToken?.let(VoiceCaptureForegroundService::release)
        emitPcm("stopped", null, sampleRate, 0, 0.0)
      }
    }
  }

  private fun stopPcmCaptureInternal() {
    val stopped = synchronized(this) {
      audioCaptureRunning = false
      audioCaptureGeneration += 1
      val active = audioRecord
      val token = audioCaptureLeaseToken
      audioRecord = null
      audioCaptureLeaseToken = null
      audioCaptureLeasePurpose = null
      Pair(active, token)
    }
    try { stopped.first?.stop() } catch (_: Throwable) {}
    stopped.second?.let(VoiceCaptureForegroundService::release)
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
    microphone.setPlatformRecognition(false)
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

  private fun emitRawPcm(samples: ShortArray, count: Int, sampleRate: Int, level: Double) {
    val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (index in 0 until count) bytes.putShort(samples[index])
    emitPcm("chunk", Base64.encodeToString(bytes.array(), Base64.NO_WRAP), sampleRate, count, level)
  }

  private fun emitOpus(chunk: OpusTransportChunk, sampleRate: Int) {
    val map = Arguments.createMap().apply {
      putString("type", "chunk")
      putString("encoding", "opus")
      putString("data", Base64.encodeToString(chunk.data, Base64.NO_WRAP))
      putInt("sampleRate", sampleRate)
      putInt("numChannels", 1)
      putInt("samplesPerChannel", chunk.samplesPerChannel)
      putDouble("level", chunk.level)
    }
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(AUDIO_EVENT, map)
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
    // Native Opus chunks stay smaller than the existing one-second network
    // batches so level feedback remains responsive while upload ordering and
    // acknowledgement continue to belong to RealtimeAudioUploader.
    private const val AUDIO_CHUNKS_PER_SECOND = 5
    private const val OPUS_FRAMES_PER_SECOND = 50
    private const val OPUS_BITRATE = 24_000
    // 200 ms of mono PCM16 at 96 kHz. AudioRecord may internally enlarge it;
    // this is intentionally above the usual 48 kHz route minimum so capture
    // remains smooth while the JS bridge handles the previous chunk.
    private const val AUDIO_LOG_TAG = "CodeWideAudio"
    private const val VOICE_AURA_LOG_TAG = "CodeWideVoiceAura"
    private const val MAX_ENGINE_ARGUMENT_BYTES = 64 * 1024 * 1024
    private const val NATIVE_BRIDGE_CONTRACT_VERSION = 2
    private const val MAX_COMMITTED_FRAME_PAGE = 128
    private const val MAX_COMMITTED_FRAME_BYTES = 512 * 1024
    private const val DOCUMENT_IO_BUFFER_BYTES = 256 * 1024
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

    private fun engineFailure(message: String, code: Int?): String = JSONObject()
      .put("ok", false)
      .put("message", message.take(1_000))
      .apply { if (code != null) put("code", code) }
      .toString()
  }
}
