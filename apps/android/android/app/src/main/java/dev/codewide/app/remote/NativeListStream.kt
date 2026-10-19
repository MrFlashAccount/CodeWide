package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject

/**
 * The single device owner of the thread-list stream wire bounds, mirroring
 * contract/v1.json `threadListStream` (`frame`, `controlFrame`, `helloField`,
 * `rowField`, `maxRowsPerFrame`). The engine checks every `threadListRows`
 * frame here before it reaches JS; a frame breaking its shape or a bound is
 * rejected closed with `invalid_list_rows`, like `invalid_event`.
 *
 * Row content (thread metadata, live activity) is validated by the JS adapter
 * `data/threadListRow.ts`; this owner checks only the envelope, identities,
 * cursors and limits that make a frame safe to forward.
 */
internal object NativeListStream {
  const val FRAME = "threadListRows"
  const val CONTROL_FRAME = "listStream"
  const val HELLO_FIELD = "listStream"
  const val ROW_FIELD = "codewideList"
  const val MAX_ROWS_PER_FRAME = 100

  /** `hello.listStream` and the `listStream` control frame carry the same object. */
  fun visibility(visible: Boolean): JSONObject = JSONObject().put("visible", visible)

  fun controlFrame(visible: Boolean): JSONObject =
    JSONObject().put("type", CONTROL_FRAME).put("visible", visible)

  /** True when `envelope` is a well-formed `threadListRows` frame within its bounds. */
  fun isValidFrame(envelope: JSONObject): Boolean {
    val rows = envelope.opt("rows") as? JSONArray ?: return false
    val removed = envelope.opt("removed") as? JSONArray ?: return false
    val size = rows.length() + removed.length()
    if (size == 0 || size > MAX_ROWS_PER_FRAME) return false
    val threadIds = HashSet<String>(size)
    for (index in 0 until rows.length()) {
      val row = rows.opt(index) as? JSONObject ?: return false
      val meta = row.opt(ROW_FIELD) as? JSONObject ?: return false
      val threadId = threadId(row.opt("id")) ?: return false
      if (cursor(meta.opt("cursor")) == null || meta.opt("archived") !is Boolean) return false
      if (!meta.has("liveActivity")) return false
      val activity = meta.opt("liveActivity")
      if (activity != JSONObject.NULL && activity !is JSONObject) return false
      if (!threadIds.add(threadId)) return false
    }
    for (index in 0 until removed.length()) {
      val tombstone = removed.opt(index) as? JSONObject ?: return false
      val threadId = threadId(tombstone.opt("threadId")) ?: return false
      if (cursor(tombstone.opt("cursor")) == null) return false
      if (!threadIds.add(threadId)) return false
    }
    return true
  }

  private fun threadId(value: Any?): String? =
    (value as? String)?.takeIf { it.isNotEmpty() && it.length <= NativeSyncInterest.MAX_INTEREST_THREAD_ID_CHARS }

  /** A journal cursor is a non-negative integer; a fractional or negative number is invalid. */
  private fun cursor(value: Any?): Long? {
    val number = value as? Number ?: return null
    val cursor = number.toLong()
    return if (cursor >= 0L && number.toDouble() == cursor.toDouble()) cursor else null
  }
}

/**
 * One connection's list-stream state inside [NativeProtocolEngine], guarded by
 * the engine monitor: in-memory visibility, which every `hello` declares and an
 * open socket receives inline as `listStream`, and the transport generation of
 * the current socket, which JS uses to fence rows and pages.
 */
internal class NativeListStreamChannel(
  private val connectionId: String,
  private var visible: Boolean,
  private val sendFrame: (String) -> Boolean,
  private val resetTransport: (String) -> Unit,
  private val telemetry: NativeTelemetryRecorder,
) {
  var generation = 0L
    private set
  private var helloSent = false

  fun onSocketOpen(socketGeneration: Long) {
    generation = socketGeneration
  }

  fun helloField(): JSONObject = NativeListStream.visibility(visible)

  fun onHelloSent() {
    helloSent = true
  }

  fun onSocketClosed() {
    helloSent = false
  }

  /** A change reaches an open socket before any later frame; a closed one declares it in `hello`. */
  fun setVisible(next: Boolean) {
    if (visible == next) return
    visible = next
    if (!helloSent) return
    telemetry.record(NativeTelemetryMetric("sync.list_stream_sent", tags = mapOf("visible" to next.toString())))
    if (!sendFrame(NativeListStream.controlFrame(next).toString())) {
      // The value is retained; the replacement socket declares it in hello.
      helloSent = false
      resetTransport("list_stream_send_failed")
    }
  }

  /** Forwards a bounded row frame with the socket generation; a malformed frame resets closed. */
  fun onFrame(envelope: JSONObject, text: String, frameBytes: Int) {
    if (!NativeListStream.isValidFrame(envelope)) {
      telemetry.record(NativeTelemetryMetric(
        "sync.list_rows_rejected",
        values = mapOf("responseBytes" to frameBytes),
        tags = mapOf("reason" to "invalid_list_rows"),
      ))
      resetTransport("invalid_list_rows")
      return
    }
    // The validated frame text is forwarded verbatim instead of being re-serialized.
    CodeWideModule.emitEngineEvent(
      connectionId,
      NativeListStream.FRAME,
      "{\"generation\":$generation,\"frame\":$text}",
      null,
    )
  }
}
