package dev.codewide.app.remote

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class V2TerminalFrameCodecTest {
  @Test
  fun encodesTheGeneratedOpenBoundaryAndDecodesOutput() {
    val open = V2TerminalFrameCodec.open(
      sessionId = "terminal-session",
      threadId = "thread",
      generation = "7",
      cwd = null,
      cols = 120,
      rows = 40,
      offset = "3",
      create = true,
    )
    assertTrue(SyncV2ContractGenerated.validateDefinitionJson("terminalClientRecord", open))
    assertEquals("open", JSONObject(open).getString("type"))

    val output = V2TerminalFrameCodec.decodeServer("""{"type":"output","offset":"3","data":"YQ=="}""")
    assertTrue(output is V2TerminalServerRecord.Output)
    assertEquals("3", (output as V2TerminalServerRecord.Output).offset)
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsInputBeyondThePublicBound() {
    V2TerminalFrameCodec.input("x".repeat(1_398_105))
  }
}
