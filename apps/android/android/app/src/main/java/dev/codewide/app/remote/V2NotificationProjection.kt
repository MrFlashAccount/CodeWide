package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject

internal sealed interface V2NotificationEffect {
  data class TurnFinished(val threadId: String, val failed: Boolean) : V2NotificationEffect
  data class ApprovalOpened(val threadId: String?, val requestKey: String) : V2NotificationEffect
  data class ApprovalClosed(val requestKey: String) : V2NotificationEffect
}

/**
 * Reduces the same closed V2 projection frames consumed by the application into
 * the small, content-free state needed by Android notifications.
 */
internal class V2NotificationProjection(restoredState: String? = null) {
  private data class PendingRequest(val threadId: String?)

  private val threadStates = mutableMapOf<String, String>()
  private val turnStates = mutableMapOf<String, String>()
  private val pendingRequests = mutableMapOf<String, PendingRequest>()
  private val notifiedTurns = mutableMapOf<String, String>()
  private var initialized = false
  private var dirty = false

  init {
    if (restoredState != null) restore(restoredState)
  }

  @Synchronized
  fun observe(
    text: String,
    persistState: ((String) -> Unit)? = null,
  ): List<V2NotificationEffect> {
    dirty = false
    val frame = SyncV2ContractGenerated.parseServerFrame(text)
    val effects = mutableListOf<V2NotificationEffect>()
    when (frame.getString("type")) {
      "snapshot" -> applySnapshot(frame, effects)
      "change" -> applyChange(frame.getJSONObject("change"), effects, initialized)
    }
    if (dirty) persistState?.invoke(stateJson())
    return effects
  }

  @Synchronized fun activeThreadCount(): Int = threadStates.values.count(::activeThreadState)

  @Synchronized fun pendingRequestCount(): Int = pendingRequests.size

  @Synchronized
  fun closePendingRequests(): List<V2NotificationEffect.ApprovalClosed> {
    val effects = pendingRequests.keys.map(V2NotificationEffect::ApprovalClosed)
    pendingRequests.clear()
    if (effects.isNotEmpty()) dirty = true
    return effects
  }

  private fun applySnapshot(frame: JSONObject, effects: MutableList<V2NotificationEffect>) {
    val notifyTransitions = initialized
    val catalog = frame.getJSONObject("catalog")
    val visibleThreads = mutableSetOf<String>()
    applyThreadArray(catalog.getJSONArray("active"), visibleThreads, effects, notifyTransitions)
    applyThreadArray(catalog.getJSONArray("archived"), visibleThreads, effects, notifyTransitions)
    val currentThread = frame.optJSONObject("currentThread")
    val visibleTurns = mutableSetOf<String>()
    if (currentThread != null) {
      val currentSummary = currentThread.getJSONObject("thread")
      visibleThreads += currentSummary.getString("id")
      applyThread(currentSummary, effects, notifyTransitions)
      applyTurnArray(currentThread.getJSONArray("turns"), visibleTurns, effects, notifyTransitions)
    }
    if (threadStates.keys.retainAll(visibleThreads)) dirty = true
    if (turnStates.keys.retainAll(visibleTurns)) dirty = true
    reconcilePending(frame.getJSONArray("pendingRequests"), effects)
    if (!initialized) dirty = true
    initialized = true
    val includedTail = frame.getJSONArray("includedTail")
    for (index in 0 until includedTail.length()) {
      applyChange(includedTail.getJSONObject(index).getJSONObject("change"), effects, true)
    }
  }

  private fun applyThreadArray(
    threads: JSONArray,
    visibleThreads: MutableSet<String>,
    effects: MutableList<V2NotificationEffect>,
    notifyTransitions: Boolean,
  ) {
    for (index in 0 until threads.length()) {
      val thread = threads.getJSONObject(index)
      visibleThreads += thread.getString("id")
      applyThread(thread, effects, notifyTransitions)
    }
  }

  private fun applyTurnArray(
    turns: JSONArray,
    visibleTurns: MutableSet<String>?,
    effects: MutableList<V2NotificationEffect>,
    notifyTransitions: Boolean,
  ) {
    for (index in 0 until turns.length()) {
      val turn = turns.getJSONObject(index)
      visibleTurns?.add("${turn.getString("threadId")}\u0000${turn.getString("id")}")
      applyTurn(turn, effects, notifyTransitions)
    }
  }

  private fun applyChange(
    change: JSONObject,
    effects: MutableList<V2NotificationEffect>,
    notifyTransitions: Boolean,
  ) {
    when (change.getString("kind")) {
      "threadUpserted" -> applyThread(change.getJSONObject("thread"), effects, notifyTransitions)
      "threadRemoved" -> if (threadStates.remove(change.getString("threadId")) != null) dirty = true
      "currentThreadReplaced" -> {
        val currentThread = change.getJSONObject("currentThread")
        applyThread(currentThread.getJSONObject("thread"), effects, notifyTransitions)
        applyTurnArray(currentThread.getJSONArray("turns"), null, effects, notifyTransitions)
        reconcilePending(change.getJSONArray("pendingRequests"), effects)
      }
      "turnUpserted" -> applyTurn(change.getJSONObject("turn"), effects, notifyTransitions)
      "pendingRequestOpened" -> openPending(change.getJSONObject("request"), effects)
      "pendingRequestClosed" -> closePending(
        change.getString("requestId"),
        change.getString("generation"),
        effects,
      )
    }
  }

  private fun applyThread(
    thread: JSONObject,
    effects: MutableList<V2NotificationEffect>,
    notifyTransitions: Boolean,
  ) {
    val threadId = thread.getString("id")
    val next = thread.getString("state")
    val previous = threadStates.put(threadId, next)
    if (previous != next) dirty = true
    val turnId = thread.optString("headTurnId").takeIf { it.isNotBlank() }
    if (
      notifyTransitions &&
      previous != null &&
      activeThreadState(previous) &&
      terminalThreadState(next) &&
      turnId != null
    ) {
      finishTurn(threadId, turnId, next == "failed", effects)
    }
  }

  private fun applyTurn(
    turn: JSONObject,
    effects: MutableList<V2NotificationEffect>,
    notifyTransitions: Boolean,
  ) {
    val threadId = turn.getString("threadId")
    val turnId = turn.getString("id")
    val next = turn.getString("state")
    val key = "$threadId\u0000$turnId"
    val previous = turnStates.put(key, next)
    if (previous != next) dirty = true
    if (
      notifyTransitions &&
      previous != null &&
      activeTurnState(previous) &&
      terminalTurnState(next)
    ) {
      finishTurn(threadId, turnId, next == "failed", effects)
    }
  }

  private fun finishTurn(
    threadId: String,
    turnId: String,
    failed: Boolean,
    effects: MutableList<V2NotificationEffect>,
  ) {
    if (notifiedTurns[threadId] == turnId) return
    notifiedTurns[threadId] = turnId
    dirty = true
    effects += V2NotificationEffect.TurnFinished(threadId, failed)
  }

  private fun reconcilePending(
    pending: JSONArray,
    effects: MutableList<V2NotificationEffect>,
  ) {
    val incoming = mutableSetOf<String>()
    for (index in 0 until pending.length()) {
      val request = pending.getJSONObject(index)
      val key = pendingKey(request.getString("generation"), request.getString("id"))
      incoming += key
      openPending(request, effects)
    }
    val removed = pendingRequests.entries
      .filterNot { incoming.contains(it.key) }
      .map { it.key }
    for (key in removed) {
      pendingRequests.remove(key)
      dirty = true
      effects += V2NotificationEffect.ApprovalClosed(key)
    }
  }

  private fun openPending(request: JSONObject, effects: MutableList<V2NotificationEffect>) {
    val key = pendingKey(request.getString("generation"), request.getString("id"))
    val threadId = request.optString("threadId").takeIf { it.isNotBlank() }
    if (pendingRequests.put(key, PendingRequest(threadId)) == null) {
      dirty = true
      effects += V2NotificationEffect.ApprovalOpened(threadId, key)
    }
  }

  private fun closePending(
    requestId: String,
    generation: String,
    effects: MutableList<V2NotificationEffect>,
  ) {
    val key = pendingKey(generation, requestId)
    if (pendingRequests.remove(key) != null) {
      dirty = true
      effects += V2NotificationEffect.ApprovalClosed(key)
    }
  }

  private fun pendingKey(generation: String, requestId: String): String = "$generation:$requestId"

  private fun stateJson(): String = JSONObject()
    .put("version", 1)
    .put("initialized", initialized)
    .put("threadStates", stringMapJson(threadStates))
    .put("turnStates", stringMapJson(turnStates))
    .put("notifiedTurns", stringMapJson(notifiedTurns))
    .put(
      "pendingRequests",
      JSONArray().apply {
        for ((key, request) in pendingRequests) {
          put(
            JSONObject()
              .put("key", key)
              .put("threadId", request.threadId ?: JSONObject.NULL),
          )
        }
      },
    )
    .toString()

  private fun restore(text: String) {
    runCatching {
      val state = JSONObject(text)
      require(state.getInt("version") == 1) { "Unsupported V2 notification state" }
      initialized = state.getBoolean("initialized")
      restoreStringMap(state.getJSONObject("threadStates"), threadStates)
      restoreStringMap(state.getJSONObject("turnStates"), turnStates)
      restoreStringMap(state.getJSONObject("notifiedTurns"), notifiedTurns)
      val pending = state.getJSONArray("pendingRequests")
      for (index in 0 until pending.length()) {
        val row = pending.getJSONObject(index)
        val key = row.getString("key")
        val threadId = if (row.isNull("threadId")) null else row.getString("threadId")
        pendingRequests[key] = PendingRequest(threadId)
      }
    }.onFailure {
      initialized = false
      threadStates.clear()
      turnStates.clear()
      notifiedTurns.clear()
      pendingRequests.clear()
    }
  }

  private companion object {
    fun stringMapJson(values: Map<String, String>): JSONObject = JSONObject().apply {
      for ((key, value) in values) put(key, value)
    }

    fun restoreStringMap(source: JSONObject, target: MutableMap<String, String>) {
      for (key in source.keys()) target[key] = source.getString(key)
    }

    fun activeThreadState(state: String): Boolean =
      state == "running" || state == "waitingForApproval" || state == "waitingForInput"

    fun terminalThreadState(state: String): Boolean =
      state == "completed" || state == "failed" || state == "interrupted"

    fun activeTurnState(state: String): Boolean = state == "queued" || state == "running"

    fun terminalTurnState(state: String): Boolean =
      state == "completed" || state == "failed" || state == "interrupted"
  }
}
