package dev.codewide.app.remote

import android.os.Handler
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

internal class NativeRpcException(val rpcCode: Int, message: String) : Exception(message)

/**
 * Durable owner of the CodeWide sync protocol.
 *
 * React is a projection consumer only: this engine owns hello/cursor, replay,
 * snapshot collection, RPC correlation and acknowledgements even while there
 * is no React context (process recreation, background, OTA reload).
 */
internal class NativeProtocolEngine(
  private val connectionId: String,
  private val frameStore: NativeFrameStore,
  private val handler: Handler,
  private val journalHandler: Handler,
  private val sendFrame: (String) -> Boolean,
  private val resetTransport: (String) -> Unit,
  private val onLive: () -> Unit,
) {
  private data class PendingRpc(
    val method: String,
    val timeout: Runnable,
    val completion: (Result<Any?>) -> Unit,
  )

  private data class DeferredRpc(
    val method: String,
    val params: Any?,
    val rpcTimeoutMs: Long,
    val liveTimeout: Runnable,
    val completion: (Result<Any?>) -> Unit,
  )

  private val requestIds = AtomicLong(System.currentTimeMillis())
  private val pendingRpcs = linkedMapOf<String, PendingRpc>()
  private val pendingServerResponses = linkedMapOf<String, PendingRpc>()
  private val deferredRpcs = linkedMapOf<String, DeferredRpc>()
  private var upstreamLive = false
  private var snapshotHead: Long? = null
  private var catchUpHead: Long? = null
  private var snapshotLoading = false
  private var state = "connecting"
  private var diagnostic: String? = null
  private var maximumObservedCursor = 0L
  private var lastAckCursor = 0L
  private val journalFrames = mutableListOf<IncomingJournalFrame>()
  private var journalBytes = 0
  private var journalFlush: Runnable? = null
  private var journalFlushAtMs: Long? = null

  @Synchronized
  fun onSocketOpen() {
    upstreamLive = false
    snapshotHead = null
    catchUpHead = null
    snapshotLoading = false
    maximumObservedCursor = frameStore.syncCursor(connectionId) ?: 0L
    lastAckCursor = maximumObservedCursor
    emitState("connecting")
    val hello = JSONObject()
      .put("type", "hello")
      .put("protocolVersion", 1)
      .put("cursor", frameStore.syncCursor(connectionId) ?: JSONObject.NULL)
    if (!sendFrame(hello.toString())) resetTransport("native_hello_failed")
  }

  @Synchronized
  fun onSocketClosed(message: String = "Connection interrupted") {
    flushJournalFrames()
    upstreamLive = false
    snapshotLoading = false
    snapshotHead = null
    catchUpHead = null
    rejectInFlight(message)
    emitState("connecting", message)
  }

  @Synchronized
  fun close(message: String = "Connection session closed") {
    flushJournalFrames()
    upstreamLive = false
    rejectInFlight(message)
    rejectDeferred(message)
  }

  @Synchronized
  fun isLive(): Boolean = upstreamLive

  @Synchronized
  fun onTransportState(next: String, message: String? = null) {
    if (next == "live") return
    upstreamLive = false
    when (next) {
      "reconnecting", "connecting" -> emitState("connecting", message)
      "offline", "degraded" -> emitState(next, message)
      "authRequired" -> {
        rejectDeferred(message ?: "Authorization required")
        emitState(next, message)
      }
    }
  }

  @Synchronized
  fun onFrame(text: String) {
    val envelope = try {
      JSONObject(text)
    } catch (_: Throwable) {
      resetTransport("invalid_json")
      return
    }
    when (envelope.optString("type")) {
      "status" -> handleStatus(envelope)
      "hello" -> handleHello(envelope)
      "rpc" -> resolveRpc(envelope.optJSONObject("response"))
      "event" -> handleEvent(envelope, text)
      "caughtUp" -> handleCaughtUp(envelope)
      "serverResponseAccepted" -> resolveServerResponse(envelope, true)
      "serverResponseRejected" -> resolveServerResponse(envelope, false)
      "pong" -> Unit
      else -> resetTransport("unknown_sync_message")
    }
  }

  @Synchronized
  fun rpc(method: String, params: Any?, timeoutMs: Long = RPC_TIMEOUT_MS, completion: (Result<Any?>) -> Unit) {
    val effectiveTimeoutMs = when (method) {
      "companion/dictation/finish" -> maxOf(timeoutMs, DICTATION_FINISH_RPC_TIMEOUT_MS)
      "companion/workspace/create" -> maxOf(timeoutMs, WORKSPACE_CREATE_RPC_TIMEOUT_MS)
      "thread/fork" -> maxOf(timeoutMs, THREAD_FORK_RPC_TIMEOUT_MS)
      else -> timeoutMs
    }
    if (!upstreamLive) {
      if (EPHEMERAL_CONTROL_METHODS.contains(method)) {
        completion(Result.failure(IllegalStateException("Connection is not live")))
        return
      }
      deferRpc(method, params, effectiveTimeoutMs, completion)
      return
    }
    dispatchRpc(method, params, effectiveTimeoutMs, completion)
  }

  private fun dispatchRpc(method: String, params: Any?, timeoutMs: Long, completion: (Result<Any?>) -> Unit) {
    val id = "native:${requestIds.incrementAndGet()}"
    val timeout = Runnable {
      synchronized(this@NativeProtocolEngine) {
        val pending = pendingRpcs.remove(id) ?: return@synchronized
        pending.completion(Result.failure(IllegalStateException("RPC timed out: ${pending.method}")))
      }
    }
    pendingRpcs[id] = PendingRpc(method, timeout, completion)
    handler.postDelayed(timeout, timeoutMs)
    val request = JSONObject().put("id", id).put("method", method).put("params", params ?: JSONObject.NULL)
    if (!sendFrame(JSONObject().put("type", "rpc").put("request", request).toString())) {
      handler.removeCallbacks(timeout)
      pendingRpcs.remove(id)
      upstreamLive = false
      deferRpc(method, params, timeoutMs, completion)
      resetTransport("rpc_send_failed")
    }
  }

  private fun deferRpc(method: String, params: Any?, timeoutMs: Long, completion: (Result<Any?>) -> Unit) {
    if (deferredRpcs.size >= MAX_DEFERRED_RPCS) {
      completion(Result.failure(IllegalStateException("Connection recovery queue is full")))
      return
    }
    val id = "deferred:${requestIds.incrementAndGet()}"
    val liveTimeout = Runnable {
      synchronized(this@NativeProtocolEngine) {
        val deferred = deferredRpcs.remove(id) ?: return@synchronized
        deferred.completion(Result.failure(IllegalStateException("Connection did not recover within ${RPC_LIVE_WAIT_TIMEOUT_MS / 1_000} seconds")))
      }
    }
    deferredRpcs[id] = DeferredRpc(method, params, timeoutMs, liveTimeout, completion)
    handler.postDelayed(liveTimeout, RPC_LIVE_WAIT_TIMEOUT_MS)
  }

  private fun dispatchDeferredRpcs() {
    if (!upstreamLive || deferredRpcs.isEmpty()) return
    val queued = deferredRpcs.values.toList()
    deferredRpcs.clear()
    queued.forEach { deferred ->
      handler.removeCallbacks(deferred.liveTimeout)
      dispatchRpc(deferred.method, deferred.params, deferred.rpcTimeoutMs, deferred.completion)
    }
  }

  @Synchronized
  fun respondToServerRequest(requestId: Any, result: Any?, completion: (Result<Any?>) -> Unit) {
    if (!upstreamLive) {
      completion(Result.failure(IllegalStateException("Connection is not live")))
      return
    }
    val key = requestKey(requestId)
    if (pendingServerResponses.containsKey(key)) {
      completion(Result.failure(IllegalStateException("Server request response is already pending")))
      return
    }
    val timeout = Runnable {
      synchronized(this@NativeProtocolEngine) {
        val pending = pendingServerResponses.remove(key) ?: return@synchronized
        pending.completion(Result.failure(IllegalStateException("Server request response timed out")))
      }
    }
    pendingServerResponses[key] = PendingRpc("serverResponse", timeout, completion)
    handler.postDelayed(timeout, RPC_TIMEOUT_MS)
    val response = JSONObject().put("id", requestId).put("result", result ?: JSONObject.NULL)
    if (!sendFrame(JSONObject().put("type", "serverResponse").put("response", response).toString())) {
      handler.removeCallbacks(timeout)
      pendingServerResponses.remove(key)
      completion(Result.failure(IllegalStateException("Connection is not live")))
    }
  }

  @Synchronized
  fun attachRuntime() {
    flushJournalFrames()
    val checkpoint = frameStore.checkpoint(connectionId)
    if (checkpoint.snapshotCursor != null && checkpoint.snapshotJson != null) {
      CodeWideModule.emitEngineEvent(
        connectionId,
        "snapshot",
        JSONObject().put("cursor", checkpoint.snapshotCursor).put("threads", JSONArray(checkpoint.snapshotJson)).toString(),
        null,
        checkpoint.snapshotCursor,
      )
    }
    CodeWideModule.emitEngineEvent(connectionId, "pendingRequests", checkpoint.pendingRequestsJson, null)
    emitJournalAdvanced(checkpoint.journalHeadCursor, recovery = true)
    emitState(state, diagnostic)
  }

  private fun handleStatus(envelope: JSONObject) {
    val next = envelope.optString("status")
    val error = envelope.optString("error").takeIf { it.isNotBlank() }?.take(1_000)
    if (next == "live") {
      upstreamLive = true
      if (snapshotHead != null || catchUpHead != null) emitState("syncing") else emitState("live")
      snapshotHead?.let(::loadSnapshot)
      dispatchDeferredRpcs()
      onLive()
      return
    }
    upstreamLive = false
    rejectInFlight("Connection unavailable")
    when (next) {
      "reconnecting", "connecting" -> emitState("connecting", error)
      "offline", "syncing", "degraded" -> emitState(next, error)
      "authRequired" -> {
        rejectDeferred(error ?: "Authorization required")
        emitState(next, error)
      }
      else -> resetTransport("invalid_status")
    }
  }

  private fun handleHello(envelope: JSONObject) {
    if (!envelope.has("headCursor")) {
      resetTransport("invalid_head_cursor")
      return
    }
    val head = envelope.optLong("headCursor", -1L)
    if (head < 0L) {
      resetTransport("invalid_head_cursor")
      return
    }
    maximumObservedCursor = head
    val pending = envelope.optJSONArray("pendingRequests") ?: JSONArray()
    frameStore.storePendingRequests(connectionId, pending.toString())
    CodeWideModule.emitEngineEvent(connectionId, "pendingRequests", pending.toString(), null)
    if (envelope.optBoolean("snapshotRequired", false)) {
      snapshotHead = head
      catchUpHead = null
      emitState("syncing")
      if (upstreamLive) loadSnapshot(head)
    } else {
      snapshotHead = null
      catchUpHead = head
      emitState("syncing")
    }
  }

  private fun handleEvent(envelope: JSONObject, text: String) {
    val cursor = envelope.optLong("cursor", -1L)
    val payload = envelope.optJSONObject("payload")
    if (cursor < 0L || payload == null) {
      resetTransport("invalid_event")
      return
    }
    maximumObservedCursor = maxOf(maximumObservedCursor, cursor)
    val method = payload.optString("method")
    queueJournalFrame(
      IncomingJournalFrame(cursor, text, payload.takeIf(NativeFrameStore::changesPendingRequests)),
      ProjectionBatchPolicy.shouldFlushImmediately(method),
      ProjectionBatchPolicy.flushDelayMs(method),
    )
  }

  private fun handleCaughtUp(envelope: JSONObject) {
    val cursor = envelope.optLong("cursor", -1L)
    if (cursor < 0L || catchUpHead != cursor) {
      resetTransport("invalid_caught_up_cursor")
      return
    }
    snapshotHead = null
    catchUpHead = null
    flushJournalFrames()
    emitState(if (upstreamLive) "live" else "connecting")
  }

  private fun loadSnapshot(head: Long) {
    if (!upstreamLive || snapshotHead != head || snapshotLoading) return
    snapshotLoading = true
    val active = JSONArray()
    val archived = JSONArray()
    var activeDone = false
    var archivedDone = false
    var failed = false
    fun finishIfReady() {
      if (failed || !activeDone || !archivedDone) return
      val collected = JSONArray()
      for (index in 0 until active.length()) collected.put(active.get(index))
      for (index in 0 until archived.length()) collected.put(archived.get(index))
      finishSnapshot(head, collected)
    }
    fun fail(error: Throwable) {
      if (failed) return
      failed = true
      snapshotFailed(error)
    }
    loadSnapshotPage(head, false, null, mutableSetOf(), active) { result ->
      result.fold(onSuccess = { activeDone = true; finishIfReady() }, onFailure = ::fail)
    }
    loadSnapshotPage(head, true, null, mutableSetOf(), archived) { result ->
      result.fold(onSuccess = { archivedDone = true; finishIfReady() }, onFailure = ::fail)
    }
  }

  private fun loadSnapshotPage(
    head: Long,
    archived: Boolean,
    cursor: String?,
    seen: MutableSet<String>,
    collected: JSONArray,
    completion: (Result<Unit>) -> Unit,
  ) {
    if (!upstreamLive || snapshotHead != head) {
      completion(Result.failure(IllegalStateException("Snapshot superseded")))
      return
    }
    val params = JSONObject()
      .put("cursor", cursor ?: JSONObject.NULL)
      .put("limit", 100)
      .put("sortKey", "updated_at")
      .put("sortDirection", "desc")
      .put("archived", archived)
      .put("modelProviders", JSONArray())
      // Keep interactive catalog hydration on Codex's queryable metadata path.
      // JSONL scan-and-repair is maintenance work and must not block recovery.
      .put("useStateDbOnly", true)
    rpc("thread/list", params, SNAPSHOT_RPC_TIMEOUT_MS) { result ->
      result.fold(
        onSuccess = { raw ->
          val page = raw as? JSONObject
          val data = page?.optJSONArray("data")
          if (page == null || data == null) {
            completion(Result.failure(IllegalStateException("Invalid thread/list response")))
            return@fold
          }
          for (index in 0 until data.length()) {
            val thread = data.optJSONObject(index) ?: continue
            collected.put(JSONObject().put("thread", thread).put("archived", archived))
          }
          val next = if (page.isNull("nextCursor")) null else page.optString("nextCursor").takeIf { it.isNotBlank() }
          if (next == null) completion(Result.success(Unit))
          else if (!seen.add(next)) completion(Result.failure(IllegalStateException("thread/list returned a repeated cursor")))
          else loadSnapshotPage(head, archived, next, seen, collected, completion)
        },
        onFailure = { completion(Result.failure(it)) },
      )
    }
  }

  private fun finishSnapshot(head: Long, collected: JSONArray) {
    if (!upstreamLive || snapshotHead != head) return
    try {
      frameStore.storeSnapshot(connectionId, head, collected.toString())
      CodeWideModule.emitEngineEvent(
        connectionId,
        "snapshot",
        JSONObject().put("cursor", head).put("threads", collected).toString(),
        null,
        head,
      )
      snapshotLoading = false
      sendFrame(JSONObject().put("type", "snapshotApplied").put("cursor", head).toString())
    } catch (error: Throwable) {
      snapshotFailed(error)
    }
  }

  private fun snapshotFailed(error: Throwable) {
    snapshotLoading = false
    upstreamLive = false
    emitState("degraded", error.message ?: "Snapshot synchronization failed")
    resetTransport("snapshot_failed")
  }

  private fun resolveRpc(response: JSONObject?) {
    if (response == null) return
    val id = response.optString("id")
    val pending = pendingRpcs.remove(id) ?: return
    handler.removeCallbacks(pending.timeout)
    val error = response.optJSONObject("error")
    if (error != null) {
      pending.completion(Result.failure(NativeRpcException(error.optInt("code", -32_000), error.optString("message", "RPC failed"))))
    } else {
      pending.completion(Result.success(if (response.has("result")) response.opt("result") else JSONObject.NULL))
    }
  }

  private fun resolveServerResponse(envelope: JSONObject, accepted: Boolean) {
    val id = envelope.opt("id") ?: return
    val pending = pendingServerResponses.remove(requestKey(id)) ?: return
    handler.removeCallbacks(pending.timeout)
    if (accepted) pending.completion(Result.success(JSONObject.NULL))
    else pending.completion(Result.failure(NativeRpcException(-32_000, "Server response rejected: ${envelope.optString("reason", "unknown")}")))
  }

  private fun acknowledge(cursor: Long) {
    if (cursor < lastAckCursor || cursor > maximumObservedCursor) return
    if (sendFrame(JSONObject().put("type", "ack").put("cursor", cursor).toString())) lastAckCursor = cursor
  }

  @Synchronized
  private fun queueJournalFrame(frame: IncomingJournalFrame, flushImmediately: Boolean, flushDelayMs: Long) {
    val bytes = frame.payload.toByteArray(Charsets.UTF_8).size
    if (journalFrames.isNotEmpty() && (journalFrames.size >= MAX_JOURNAL_BATCH || journalBytes + bytes > MAX_JOURNAL_BYTES)) {
      flushJournalFrames()
    }
    journalFrames += frame
    journalBytes += bytes
    if (flushImmediately) {
      flushJournalFrames()
      return
    }
    val flushAtMs = SystemClock.uptimeMillis() + flushDelayMs
    val scheduledAtMs = journalFlushAtMs
    if (journalFlush != null && scheduledAtMs != null && scheduledAtMs <= flushAtMs) return
    journalFlush?.let(journalHandler::removeCallbacks)
    val runnable = Runnable {
      synchronized(this@NativeProtocolEngine) {
        journalFlush = null
        journalFlushAtMs = null
        flushJournalFrames()
      }
    }
    journalFlush = runnable
    journalFlushAtMs = flushAtMs
    journalHandler.postDelayed(runnable, flushDelayMs)
  }

  @Synchronized
  private fun flushJournalFrames() {
    journalFlush?.let(journalHandler::removeCallbacks)
    journalFlush = null
    journalFlushAtMs = null
    if (journalFrames.isEmpty()) return
    val batch = journalFrames.toList()
    val batchBytes = journalBytes
    journalFrames.clear()
    journalBytes = 0
    val commitStartedAt = SystemClock.elapsedRealtimeNanos()
    val result = frameStore.appendEvents(connectionId, batch)
    val commitMs = (SystemClock.elapsedRealtimeNanos() - commitStartedAt) / 1_000_000.0
    when (result.status) {
      JournalAppendStatus.OVERFLOW -> resetTransport("native_frame_journal_overflow")
      JournalAppendStatus.NON_CONTIGUOUS -> resetTransport("non_contiguous_sync_cursor")
      JournalAppendStatus.COMMITTED -> {
        result.acknowledgedCursor?.let(::acknowledge)
        result.frames.lastOrNull()?.cursor?.let {
          emitJournalAdvanced(
            it,
            recovery = false,
            eventCount = result.frames.size,
            bytes = batchBytes,
            commitMs = commitMs,
            storage = frameStore.storageStats(),
          )
        }
        if (result.frames.isNotEmpty() && batch.any { it.pendingRequestPayload != null }) {
          CodeWideModule.emitEngineEvent(connectionId, "pendingRequests", frameStore.pendingRequestsJson(connectionId), null)
        }
      }
    }
  }

  private fun emitJournalAdvanced(
    cursor: Long?,
    recovery: Boolean,
    eventCount: Int = 0,
    bytes: Int = 0,
    commitMs: Double = 0.0,
    storage: NativeFrameStorageStats? = null,
  ) {
    if (cursor == null) return
    CodeWideModule.emitEngineEvent(
      connectionId,
      "journalAdvanced",
      JSONObject()
        .put("recovery", recovery)
        .put("eventCount", eventCount)
        .put("bytes", bytes)
        .put("commitMs", commitMs)
        .put("journalFrameCount", storage?.frameCount ?: 0)
        .put("journalPayloadBytes", storage?.payloadBytes ?: 0)
        .put("mainFileBytes", storage?.mainFileBytes ?: 0)
        .put("walFileBytes", storage?.walFileBytes ?: 0)
        .put("shmFileBytes", storage?.shmFileBytes ?: 0)
        .toString(),
      null,
      cursor,
    )
  }

  private fun emitState(next: String, error: String? = null) {
    state = next
    diagnostic = error
    val payload = JSONObject()
      .put("state", next)
      .put("rpcAvailable", upstreamLive)
    if (!error.isNullOrBlank()) payload.put("error", error.take(1_000))
    CodeWideModule.emitEngineEvent(connectionId, "state", payload.toString(), null)
  }

  private fun rejectInFlight(message: String) {
    val failure = Result.failure<Any?>(IllegalStateException(message))
    pendingRpcs.values.toList().forEach { pending ->
      handler.removeCallbacks(pending.timeout)
      pending.completion(failure)
    }
    pendingRpcs.clear()
    pendingServerResponses.values.toList().forEach { pending ->
      handler.removeCallbacks(pending.timeout)
      pending.completion(failure)
    }
    pendingServerResponses.clear()
  }

  private fun rejectDeferred(message: String) {
    val failure = Result.failure<Any?>(IllegalStateException(message))
    deferredRpcs.values.toList().forEach { deferred ->
      handler.removeCallbacks(deferred.liveTimeout)
      deferred.completion(failure)
    }
    deferredRpcs.clear()
  }

  private fun requestKey(value: Any): String = when (value) {
    is Number -> "number:${value}"
    else -> "string:${value}"
  }

  companion object {
    private const val RPC_TIMEOUT_MS = 30_000L
    private const val DICTATION_FINISH_RPC_TIMEOUT_MS = 5 * 60_000L
    private const val WORKSPACE_CREATE_RPC_TIMEOUT_MS = 10 * 60_000L
    private const val THREAD_FORK_RPC_TIMEOUT_MS = 10 * 60_000L
    private const val RPC_LIVE_WAIT_TIMEOUT_MS = 12_000L
    private const val SNAPSHOT_RPC_TIMEOUT_MS = 120_000L
    private const val MAX_DEFERRED_RPCS = 128
    private const val MAX_JOURNAL_BATCH = 128
    private const val MAX_JOURNAL_BYTES = 512 * 1024
    private val EPHEMERAL_CONTROL_METHODS = setOf("turn/interrupt")
  }
}
