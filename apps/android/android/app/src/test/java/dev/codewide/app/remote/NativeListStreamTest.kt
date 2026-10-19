package dev.codewide.app.remote

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/**
 * Device side of the thread-list stream (docs/companion-thread-list-stream.md):
 * `hello` always declares visibility, a change reaches an open socket as one
 * `listStream` frame, and a `threadListRows` frame breaking its shape or a
 * bound resets the transport closed with `invalid_list_rows`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class NativeListStreamTest {
  private class Fixture(connectionId: String, visible: Boolean = false) {
    val frames = mutableListOf<JSONObject>()
    val resets = mutableListOf<String>()
    val handler = Handler(Looper.getMainLooper())
    val store = NativeFrameStore(RuntimeEnvironment.getApplication())
    val engine = NativeProtocolEngine(connectionId, store, handler, handler,
      sendFrame = { payload -> frames.add(JSONObject(payload)); true },
      resetTransport = resets::add, onLive = {}, onPortInventory = {}, telemetry = NativeTelemetryRecorder {},
      currentGeneration = { 7L }, initialListStreamVisible = visible)

    fun sent(type: String): List<JSONObject> = frames.filter { it.optString("type") == type }
  }

  private fun row(id: String, cursor: Any = 5): JSONObject = JSONObject()
    .put("id", id)
    .put("cwd", "/work")
    .put("turns", JSONArray())
    .put("codewideList", JSONObject().put("cursor", cursor).put("archived", false).put("liveActivity", JSONObject.NULL))

  private fun frame(rows: List<JSONObject>, removed: List<JSONObject> = emptyList()): JSONObject = JSONObject()
    .put("type", "threadListRows")
    .put("rows", JSONArray(rows))
    .put("removed", JSONArray(removed))

  private fun tombstone(id: String, cursor: Long): JSONObject = JSONObject().put("threadId", id).put("cursor", cursor)

  @Test fun helloDeclaresTheRetainedVisibility() {
    val hidden = Fixture("list-hidden")
    hidden.engine.onSocketOpen()
    assertEquals(false, hidden.sent("hello").single().getJSONObject("listStream").getBoolean("visible"))

    val visible = Fixture("list-visible", visible = true)
    visible.engine.onSocketOpen()
    assertEquals(true, visible.sent("hello").single().getJSONObject("listStream").getBoolean("visible"))
  }

  @Test fun visibilityChangesReachAnOpenSocketOnceAndAClosedSocketThroughHello() {
    val test = Fixture("list-change")
    test.engine.setListStreamVisible(true)
    assertTrue(test.sent("listStream").isEmpty())

    test.engine.onSocketOpen()
    assertEquals(true, test.sent("hello").single().getJSONObject("listStream").getBoolean("visible"))

    test.engine.setListStreamVisible(true)
    assertTrue(test.sent("listStream").isEmpty())
    test.engine.setListStreamVisible(false)
    test.engine.setListStreamVisible(false)
    assertEquals(listOf(false), test.sent("listStream").map { it.getBoolean("visible") })
    assertTrue(test.resets.isEmpty())
  }

  @Test fun aBoundedFrameIsAccepted() {
    val test = Fixture("list-accept")
    test.engine.onSocketOpen()
    val rows = (1..99).map { row("thread-$it", it) }
    test.engine.onFrame(frame(rows, listOf(tombstone("gone", 3))).toString())
    test.engine.onFrame(frame(emptyList(), listOf(tombstone("gone-only", 4))).toString())
    assertTrue(test.resets.isEmpty())
  }

  @Test fun malformedOrOversizedFramesResetClosed() {
    val invalid = listOf(
      frame(emptyList()),
      frame((1..101).map { row("thread-$it") }),
      frame((1..100).map { row("thread-$it") }, listOf(tombstone("extra", 1))),
      frame(listOf(row("same"), row("same"))),
      frame(listOf(row("same")), listOf(tombstone("same", 9))),
      frame(listOf(row("fractional", 1.5))),
      frame(listOf(row("negative", -1))),
      frame(listOf(row(""))),
      frame(listOf(row("thread").apply { remove("codewideList") })),
      frame(listOf(row("thread").apply { getJSONObject("codewideList").remove("liveActivity") })),
      frame(listOf(row("thread").apply { getJSONObject("codewideList").put("archived", "no") })),
      frame(listOf(row("thread").apply { getJSONObject("codewideList").put("liveActivity", "command") })),
      frame(listOf(row("thread"))).apply { remove("removed") },
      frame(emptyList(), listOf(JSONObject().put("threadId", "gone"))),
    )
    for (candidate in invalid) {
      val test = Fixture("list-invalid")
      test.engine.onSocketOpen()
      test.engine.onFrame(candidate.toString())
      assertEquals(candidate.toString(), listOf("invalid_list_rows"), test.resets)
    }
  }
}
