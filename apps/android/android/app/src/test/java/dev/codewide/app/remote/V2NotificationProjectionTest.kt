package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class V2NotificationProjectionTest {
  @Test
  fun completionIsEmittedOnceFromV2Authority() {
    val projection = V2NotificationProjection()

    assertEquals(emptyList<V2NotificationEffect>(), projection.observe(snapshot(thread("running"))))
    assertEquals(1, projection.activeThreadCount())
    assertEquals(
      listOf(V2NotificationEffect.TurnFinished("thread-1", false)),
      projection.observe(change(threadChange("completed"))),
    )
    assertEquals(emptyList<V2NotificationEffect>(), projection.observe(change(threadChange("completed"))))
    assertEquals(0, projection.activeThreadCount())
  }

  @Test
  fun coldSnapshotDoesNotNotifyForAnOldCompletion() {
    val projection = V2NotificationProjection()

    assertEquals(emptyList<V2NotificationEffect>(), projection.observe(snapshot(thread("completed"))))
  }

  @Test
  fun terminalSnapshotAfterTotalSocketGapDoesNotInventHistoricalCompletion() {
    var durableState: String? = null
    val original = V2NotificationProjection()
    original.observe(snapshot(thread("completed", headTurnId = "turn-before-gap"))) {
      durableState = it
    }

    val recreated = V2NotificationProjection(durableState)

    assertEquals(
      emptyList<V2NotificationEffect>(),
      recreated.observe(snapshot(thread("completed", headTurnId = "turn-during-gap"))),
    )
  }

  @Test
  fun includedTailClosesTheSnapshotToLiveRace() {
    val projection = V2NotificationProjection()
    val tail = JSONArray().put(
      JSONObject()
        .put("watermark", "2")
        .put("change", threadChange("failed")),
    )

    assertEquals(
      listOf(V2NotificationEffect.TurnFinished("thread-1", true)),
      projection.observe(snapshot(thread("running"), includedTail = tail)),
    )
  }

  @Test
  fun pendingRequestsOpenAndCloseByGenerationQualifiedIdentity() {
    val projection = V2NotificationProjection()
    val request = pendingRequest()
    val current = threadWindow(thread("waitingForApproval"))

    assertEquals(
      listOf(V2NotificationEffect.ApprovalOpened("thread-1", "7:request-1")),
      projection.observe(snapshot(thread("waitingForApproval"), current, JSONArray().put(request))),
    )
    assertEquals(1, projection.pendingRequestCount())
    assertEquals(
      listOf(V2NotificationEffect.ApprovalClosed("7:request-1")),
      projection.observe(
        change(
          JSONObject()
            .put("kind", "pendingRequestClosed")
            .put("requestId", "request-1")
            .put("generation", "7")
            .put("reason", "resolved"),
        ),
      ),
    )
    assertEquals(0, projection.pendingRequestCount())
  }

  @Test
  fun replacementSnapshotClosesRequestsMissingFromV2Authority() {
    val projection = V2NotificationProjection()
    val current = threadWindow(thread("waitingForApproval"))

    projection.observe(snapshot(thread("waitingForApproval"), current, JSONArray().put(pendingRequest())))

    assertEquals(
      listOf(V2NotificationEffect.ApprovalClosed("7:request-1")),
      projection.observe(snapshot(thread("running"), threadWindow(thread("running")))),
    )
    assertEquals(0, projection.pendingRequestCount())
  }

  @Test
  fun processRecreationRetainsRunningBaselineAndNotifiesCompletion() {
    var durableState: String? = null
    val original = V2NotificationProjection()
    original.observe(snapshot(thread("running"))) { durableState = it }

    val recreated = V2NotificationProjection(durableState)

    assertEquals(
      listOf(V2NotificationEffect.TurnFinished("thread-1", false)),
      recreated.observe(snapshot(thread("completed"))),
    )
  }

  @Test
  fun processRecreationDoesNotDuplicateAnOpenApprovalAndStillClosesIt() {
    var durableState: String? = null
    val original = V2NotificationProjection()
    original.observe(
      snapshot(
        thread("waitingForApproval"),
        threadWindow(thread("waitingForApproval")),
        JSONArray().put(pendingRequest()),
      ),
    ) { durableState = it }

    val recreated = V2NotificationProjection(durableState)
    assertEquals(
      emptyList<V2NotificationEffect>(),
      recreated.observe(
        snapshot(
          thread("waitingForApproval"),
          threadWindow(thread("waitingForApproval")),
          JSONArray().put(pendingRequest()),
        ),
      ),
    )
    assertEquals(
      listOf(V2NotificationEffect.ApprovalClosed("7:request-1")),
      recreated.observe(snapshot(thread("running"), threadWindow(thread("running")))),
    )
  }

  @Test
  fun allAccessibleApprovalForAnotherThreadStillProducesNativeEffect() {
    val projection = V2NotificationProjection()
    val current = threadWindow(thread("running"))
    val otherThreadRequest = pendingRequest(threadId = "thread-2")

    assertEquals(
      listOf(V2NotificationEffect.ApprovalOpened("thread-2", "7:request-1")),
      projection.observe(snapshot(thread("running"), current, JSONArray().put(otherThreadRequest))),
    )
  }

  @Test
  fun retiringAuthorityClosesEveryPendingApproval() {
    val projection = V2NotificationProjection()
    projection.observe(
      snapshot(
        thread("waitingForApproval"),
        threadWindow(thread("waitingForApproval")),
        JSONArray()
          .put(pendingRequest())
          .put(pendingRequest(threadId = "thread-2").put("id", "request-2")),
      ),
    )

    assertEquals(
      listOf(
        V2NotificationEffect.ApprovalClosed("7:request-1"),
        V2NotificationEffect.ApprovalClosed("7:request-2"),
      ),
      projection.closePendingRequests(),
    )
    assertEquals(0, projection.pendingRequestCount())
    assertEquals(emptyList<V2NotificationEffect>(), projection.closePendingRequests())
  }

  private fun snapshot(
    thread: JSONObject,
    currentThread: JSONObject? = null,
    pendingRequests: JSONArray = JSONArray(),
    includedTail: JSONArray = JSONArray(),
  ): String = JSONObject()
    .put("type", "snapshot")
    .put("version", 2)
    .put("sourceGeneration", "7")
    .put("epochId", "epoch-1")
    .put("revision", "sync-v2-revision:test")
    .put("watermark", "1")
    .put(
      "scope",
      JSONObject()
        .put("active", partitionScope())
        .put("archived", partitionScope()),
    )
    .put(
      "catalog",
      JSONObject()
        .put("active", JSONArray().put(thread))
        .put("archived", JSONArray()),
    )
    .put("currentThread", currentThread ?: JSONObject.NULL)
    .put("pendingRequests", pendingRequests)
    .put("includedTail", includedTail)
    .put(
      "limits",
      JSONObject()
        .put("catalogPerPartitionMax", 100)
        .put("turnWindowMax", 36)
        .put("historyPageMax", 100)
        .put("queueMaxEvents", 2_048)
        .put("queueMaxBytes", 4_194_304),
    )
    .toString()

  private fun change(payload: JSONObject): String = JSONObject()
    .put("type", "change")
    .put("epochId", "epoch-1")
    .put("watermark", "2")
    .put("change", payload)
    .toString()

  private fun threadChange(state: String): JSONObject = JSONObject()
    .put("kind", "threadUpserted")
    .put("thread", thread(state))

  private fun thread(state: String, headTurnId: String = "turn-1"): JSONObject = JSONObject()
    .put("id", "thread-1")
    .put("parentId", JSONObject.NULL)
    .put("title", "Thread")
    .put("preview", "Preview")
    .put("workspace", "/workspace")
    .put("archived", false)
    .put("state", state)
    .put("settings", JSONObject.NULL)
    .put(
      "readState",
      JSONObject()
        .put("kind", "unknown")
        .put("latestActivityMarker", JSONObject.NULL)
        .put("readThroughMarker", JSONObject.NULL)
        .put("unreadCount", JSONObject.NULL),
    )
    .put("createdAt", "2026-08-28T10:00:00Z")
    .put("updatedAt", "2026-08-28T10:00:01Z")
    .put("lastActivityAt", "2026-08-28T10:00:01Z")
    .put("headTurnId", headTurnId)

  private fun threadWindow(thread: JSONObject): JSONObject = JSONObject()
    .put("thread", thread)
    .put("turns", JSONArray())
    .put("olderCursor", JSONObject.NULL)
    .put("newerCursor", JSONObject.NULL)

  private fun pendingRequest(threadId: String = "thread-1"): JSONObject = JSONObject()
    .put("kind", "commandApproval")
    .put("id", "request-1")
    .put("generation", "7")
    .put("threadId", threadId)
    .put("turnId", "turn-1")
    .put("itemId", "item-1")
    .put("command", "run")
    .put("cwd", "/workspace")
    .put("reason", JSONObject.NULL)
    .put("networkApprovalContextJson", JSONObject.NULL)
    .put("availableDecisions", JSONArray().put("accept").put("decline"))

  private fun partitionScope(): JSONObject = JSONObject()
    .put("limit", 40)
    .put("returned", 1)
    .put("complete", true)
}
