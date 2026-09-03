package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class SyncV2ContractGeneratedTest {
  @Test
  fun embedsTheExactExecutableContractFingerprint() {
    assertEquals("21e47c9f4b0f792aa9bd1637093655ee165ba07f2273be8bd532357b2b9e8803", SyncV2ContractGenerated.CONTRACT_SHA256)
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
  fun preservesUltraEffortAndStructuredGranularApproval() {
    SyncV2ContractGenerated.parseClientFrame(
      """{"type":"command","requestId":"r","operationId":"o","command":{"kind":"thread.create","workspace":"/w","title":null,"settings":{"model":"gpt-5.6","effort":"ultra","approvalPolicy":{"granular":{"sandboxApproval":true,"rules":false,"skillApproval":true,"requestPermissions":false,"mcpElicitations":true}},"sandbox":"workspaceWrite","personality":null}}}""",
    )
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseClientFrame(
        """{"type":"command","requestId":"r","operationId":"o","command":{"kind":"thread.create","workspace":"/w","title":null,"settings":{"model":"gpt-5.6","effort":"ultra","approvalPolicy":{"granular":{"sandboxApproval":true}},"sandbox":"workspaceWrite","personality":null}}}""",
      )
    }
  }

  @Test
  fun validatesBackgroundProcessInspectionAndTermination() {
    SyncV2ContractGenerated.parseClientFrame(
      """{"type":"query","requestId":"r","query":{"kind":"thread.processes","threadId":"thread","cursor":null,"limit":100}}""",
    )
    SyncV2ContractGenerated.parseClientFrame(
      """{"type":"command","requestId":"r","operationId":"o","command":{"kind":"process.terminate","threadId":"thread","processId":"process"}}""",
    )
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseClientFrame(
        """{"type":"query","requestId":"r","query":{"kind":"thread.processes","threadId":"thread","cursor":null,"limit":101}}""",
      )
    }
  }

  @Test
  fun validatesBoundedCatalogSearch() {
    SyncV2ContractGenerated.parseClientFrame(
      """{"type":"query","requestId":"r","query":{"kind":"catalog.search","partition":"active","text":"indexed thread","cursor":null,"limit":100}}""",
    )
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseClientFrame(
        """{"type":"query","requestId":"r","query":{"kind":"catalog.search","partition":"active","text":"","cursor":null,"limit":1}}""",
      )
    }
    expectCloseCode(1008) {
      SyncV2ContractGenerated.parseClientFrame(
        """{"type":"query","requestId":"r","query":{"kind":"catalog.search","partition":"all","text":"thread","cursor":null,"limit":1}}""",
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
