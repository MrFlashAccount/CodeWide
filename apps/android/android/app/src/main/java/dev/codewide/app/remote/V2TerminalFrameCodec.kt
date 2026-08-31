package dev.codewide.app.remote

import org.json.JSONObject

internal sealed interface V2TerminalServerRecord {
  val type: String
  val json: String

  data class Opened(val sessionId: String, val generation: String, val offset: String, override val json: String) : V2TerminalServerRecord {
    override val type = "opened"
  }

  data class Output(val offset: String, val data: String, override val json: String) : V2TerminalServerRecord {
    override val type = "output"
  }

  data class Exited(val offset: String, override val json: String) : V2TerminalServerRecord {
    override val type = "exited"
  }

  data class Error(override val json: String) : V2TerminalServerRecord {
    override val type = "error"
  }
}

/** The sole handwritten Android adapter around generated V2 Terminal validation. */
internal object V2TerminalFrameCodec {
  fun open(
    sessionId: String,
    threadId: String,
    generation: String,
    cwd: String?,
    cols: Int,
    rows: Int,
    offset: String,
    create: Boolean,
  ): String = encode(JSONObject()
    .put("type", "open")
    .put("version", 2)
    .put("sessionId", sessionId)
    .put("threadId", threadId)
    .put("generation", generation)
    .put("cwd", cwd ?: JSONObject.NULL)
    .put("cols", cols)
    .put("rows", rows)
    .put("offset", offset)
    .put("create", create))

  fun input(data: String): String = encode(JSONObject().put("type", "input").put("data", data))

  fun resize(cols: Int, rows: Int): String = encode(JSONObject().put("type", "resize").put("cols", cols).put("rows", rows))

  fun close(): String = encode(JSONObject().put("type", "close"))

  fun decodeServer(text: String): V2TerminalServerRecord {
    require(SyncV2ContractGenerated.validateDefinitionJson("terminalServerRecord", text)) {
      "Invalid closed Sync V2 Terminal server record"
    }
    val value = JSONObject(text)
    return when (value.getString("type")) {
      "opened" -> V2TerminalServerRecord.Opened(value.getString("sessionId"), value.getString("generation"), value.getString("offset"), text)
      "output" -> V2TerminalServerRecord.Output(value.getString("offset"), value.getString("data"), text)
      "exited" -> V2TerminalServerRecord.Exited(value.getString("offset"), text)
      "error" -> V2TerminalServerRecord.Error(text)
      else -> error("Unreachable Sync V2 Terminal record")
    }
  }

  private fun encode(value: JSONObject): String = value.toString().also { text ->
    require(SyncV2ContractGenerated.validateDefinitionJson("terminalClientRecord", text)) {
      "Invalid closed Sync V2 Terminal client record"
    }
  }
}
