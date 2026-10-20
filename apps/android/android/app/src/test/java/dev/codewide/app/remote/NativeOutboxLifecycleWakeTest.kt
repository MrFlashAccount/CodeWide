package dev.codewide.app.remote

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeOutboxLifecycleWakeTest {
  @Test
  fun completedTurnExpeditesItsThreadAndDrainsOnce() {
    val expedited = mutableListOf<String>()
    var drains = 0
    val wake = NativeOutboxLifecycleWake(
      expediteThread = { threadId -> expedited.add(threadId); true },
      expediteServerRequest = { false },
      drain = { drains += 1 },
    )

    wake.observe("turn/completed", JSONObject().put("threadId", "thread-1"))

    assertEquals(listOf("thread-1"), expedited)
    assertEquals(1, drains)
  }

  @Test
  fun idleAndUnloadedStatusesWakeButActiveAndOpenElsewhereDoNot() {
    val expedited = mutableListOf<String>()
    var drains = 0
    val wake = NativeOutboxLifecycleWake(
      expediteThread = { threadId -> expedited.add(threadId); true },
      expediteServerRequest = { false },
      drain = { drains += 1 },
    )

    listOf("active", "openElsewhere", "idle", "notLoaded").forEach { status ->
      wake.observe(
        "thread/status/changed",
        JSONObject()
          .put("threadId", "thread-$status")
          .put("status", JSONObject().put("type", status)),
      )
    }

    assertEquals(listOf("thread-idle", "thread-notLoaded"), expedited)
    assertEquals(2, drains)
  }

  @Test
  fun resolvedServerRequestUsesTheSameTypedIdentityAsThePendingSet() {
    val expedited = mutableListOf<String>()
    var drains = 0
    val wake = NativeOutboxLifecycleWake(
      expediteThread = { false },
      expediteServerRequest = { requestKey -> expedited.add(requestKey); true },
      drain = { drains += 1 },
    )

    wake.observe("serverRequest/resolved", JSONObject().put("requestId", 7))
    wake.observe("serverRequest/resolved", JSONObject().put("requestId", "7"))

    assertEquals(listOf("number:7", "string:7"), expedited)
    assertEquals(2, drains)
  }

  @Test
  fun eventWithoutMatchingUncertainCommandDoesNotDrain() {
    var drains = 0
    val wake = NativeOutboxLifecycleWake(
      expediteThread = { false },
      expediteServerRequest = { false },
      drain = { drains += 1 },
    )

    wake.observe("turn/completed", JSONObject().put("threadId", "thread-1"))
    wake.observe("serverRequest/resolved", JSONObject())
    wake.observe("thread/status/changed", JSONObject().put("threadId", "thread-1"))

    assertEquals(0, drains)
  }
}
