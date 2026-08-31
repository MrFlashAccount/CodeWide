package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class SyncV2ContractGeneratedTest {
  @Test
  fun embedsTheExactExecutableContractFingerprint() {
    assertEquals("3520b1dff138b6c5bcef483031b71fa78cbb8adf06094323aa1e62462c1f19e0", SyncV2ContractGenerated.CONTRACT_SHA256)
  }

  @Test
  fun acceptsOnlyClosedServerFrames() {
    assertEquals("pong", SyncV2ContractGenerated.parseServerFrame("""{"type":"pong","nonce":"n"}""").getString("type"))
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseServerFrame("""{"type":"pong","nonce":"n","sourceMethod":"ping"}""")
    }
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseServerFrame(
        """{"type":"queryCompleted","requestId":"r","result":{"kind":"projects.list","projects":[],"source":{}}}""",
      )
    }
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseServerFrame(
        """{"type":"queryFailed","requestId":"r","error":{"code":"notFound","recovery":"retry","message":"missing"}}""",
      )
    }
  }

  @Test
  fun distinguishesMalformedJsonAndUtf8ByteLimit() {
    expectCloseCode(1007) { SyncV2ContractGenerated.parseServerFrame("{") }
    val oversizedId = "😀".repeat(65)
    val frame = JSONObject()
      .put("type", "query")
      .put("requestId", oversizedId)
      .put("query", JSONObject().put("kind", "capabilities.read"))
    expectCloseCode(1008) { SyncV2ContractGenerated.parseClientFrame(frame.toString()) }
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseClientFrame(
        """{"type":"command","requestId":"r","operationId":"o","command":{"kind":"thread.create","workspace":"/w","settings":{"model":null,"effort":null,"approvalPolicy":"onRequest","sandbox":"workspaceWrite"}}}""",
      )
    }
  }

  @Test
  fun enforcesSchemaDerivedArrayAndErrorMessageBounds() {
    val input = JSONArray()
    repeat(129) { input.put(JSONObject().put("kind", "text").put("text", "x")) }
    val frame = JSONObject()
      .put("type", "command")
      .put("requestId", "request")
      .put("operationId", "operation")
      .put(
        "command",
        JSONObject()
          .put("kind", "turn.steer")
          .put("threadId", "thread")
          .put("turnId", "turn")
          .put("input", input),
      )
    expectCloseCode(1008) { SyncV2ContractGenerated.parseClientFrame(frame.toString()) }
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseServerFrame(
        JSONObject()
          .put("type", "queryFailed")
          .put("requestId", "request")
          .put(
            "error",
            JSONObject()
              .put("code", "notFound")
              .put("recovery", "requery")
              .put("message", "x".repeat(129)),
          )
          .toString(),
      )
    }
  }

  @Test
  fun matchesSharedCrossRuntimeIntegerAndTimestampBoundaries() {
    val fixtures = SyncV2ContractGenerated.boundaryFixtures()
    for (index in 0 until fixtures.length()) {
      val fixture = fixtures.getJSONObject(index)
      assertEquals(
        fixture.getString("name"),
        fixture.getBoolean("valid"),
        SyncV2ContractGenerated.validateDefinitionJson(fixture.getString("definition"), fixture.getString("json")),
      )
    }
  }

  private fun expectCloseCode(expected: Int, action: () -> Unit) {
    try {
      action()
      fail("Expected SyncV2FrameException")
    } catch (error: SyncV2FrameException) {
      assertEquals(expected, error.closeCode)
    }
  }
}
