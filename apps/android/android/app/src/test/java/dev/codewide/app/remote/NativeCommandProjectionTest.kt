package dev.codewide.app.remote

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeCommandProjectionTest {
  @Test
  fun queuePutProjectionRetainsTextAndAttachmentsForReadModelRecovery() {
    val params = JSONObject()
      .put("command", JSONObject()
        .put("commandId", "client-1")
        .put("remoteThreadId", "thread-1")
        .put("params", JSONObject().put("input", org.json.JSONArray()
          .put(JSONObject().put("type", "text").put("text", "hello"))
          .put(JSONObject()
            .put("type", "remoteFile")
            .put("rootId", "root")
            .put("path", "images/a.png")
            .put("name", "a.png")
            .put("kind", "image")))))
      .toString()
    val command = NativeCommand(
      connectionId = "server",
      commandId = "queue-put-1",
      method = "companion/queue/put",
      paramsJson = params,
      state = "queued",
      attempts = 0,
      lastError = null,
      createdAt = 1,
      updatedAt = 1,
      nextAttemptAt = 0,
    )

    val projected = JSONObject(NativeCommandStore.projectionJson(command))
    assertEquals("thread-1", projected.getString("threadId"))
    assertEquals("client-1", projected.getString("targetCommandId"))
    assertEquals("hello", projected.getString("text"))
    val attachment = projected.getJSONArray("attachments").getJSONObject(0)
    assertEquals("a.png", attachment.getString("name"))
    assertEquals("root\u0000images/a.png", attachment.getString("id"))
  }
}
