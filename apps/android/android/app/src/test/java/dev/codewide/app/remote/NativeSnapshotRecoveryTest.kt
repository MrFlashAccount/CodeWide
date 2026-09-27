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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class NativeSnapshotRecoveryTest {
  private class Fixture {
    val frames = mutableListOf<JSONObject>()
    val resets = mutableListOf<String>()
    val handler = Handler(Looper.getMainLooper())
    val store = NativeFrameStore(RuntimeEnvironment.getApplication())
    val engine = NativeProtocolEngine("snapshot-recovery", store, handler, handler,
      sendFrame = { payload -> frames.add(JSONObject(payload)); true },
      resetTransport = resets::add, onLive = {}, onPortInventory = {}, telemetry = NativeTelemetryRecorder {})

    fun beginSnapshot() {
      engine.onSocketOpen()
      engine.onFrame("""{"type":"hello","headCursor":0,"snapshotRequired":true}""")
      engine.onFrame("""{"type":"status","status":"live"}""")
    }

    fun requests(): List<JSONObject> = frames.mapNotNull { it.optJSONObject("request") }

    fun reply(request: JSONObject, result: JSONObject) {
      engine.onFrame(JSONObject().put("type", "rpc").put("response", JSONObject()
        .put("id", request.getString("id")).put("result", result)).toString())
    }

    fun close() {
      engine.close()
    }
  }

  @Test fun closingAnInFlightSnapshotDoesNotRequestAnotherTransportReset() {
    val fixture = Fixture()
    try {
      fixture.beginSnapshot()
      assertEquals(listOf("thread/list", "thread/list"), fixture.requests().map { it.getString("method") })

      fixture.engine.onSocketClosed("Connection interrupted")

      assertTrue("Cancelling a dead socket must not reset its replacement", fixture.resets.isEmpty())
      fixture.beginSnapshot()
      fixture.requests().takeLast(2).forEach { request ->
        fixture.reply(request, JSONObject("""{"data":[],"nextCursor":null}"""))
      }
      assertTrue(fixture.frames.any { it.optString("type") == "snapshotApplied" })
    } finally {
      fixture.close()
    }
  }

  @Test fun genuineSnapshotFailureStillRequestsRecoveryExactlyOnce() {
    val fixture = Fixture()
    try {
      fixture.beginSnapshot()
      fixture.reply(fixture.requests().first(), JSONObject())
      assertEquals(listOf("snapshot_failed"), fixture.resets)
      fixture.engine.onSocketClosed("Connection interrupted")
      assertEquals(listOf("snapshot_failed"), fixture.resets)
    } finally {
      fixture.close()
    }
  }

  @Test fun upstreamReconnectingKeepsTheHealthyCompanionSocket() {
    val fixture = Fixture()
    try {
      fixture.beginSnapshot()
      fixture.engine.onFrame("""{"type":"status","status":"reconnecting"}""")

      assertTrue("An upstream outage does not invalidate the Companion socket", fixture.resets.isEmpty())
      fixture.engine.onFrame("""{"type":"status","status":"live"}""")
      fixture.requests().takeLast(2).forEach { request ->
        fixture.reply(request, JSONObject("""{"data":[],"nextCursor":null}"""))
      }
      assertTrue(fixture.frames.any { it.optString("type") == "snapshotApplied" })
    } finally {
      fixture.close()
    }
  }

  @Test fun aSupersededSnapshotWithTheSameHeadCannotResetOrContaminateItsReplacement() {
    val fixture = Fixture()
    try {
      fixture.beginSnapshot()
      val obsoleteRequests = fixture.requests()
      // A fresh hello owns a fresh snapshot, even at an unchanged journal head.
      fixture.engine.onFrame("""{"type":"hello","headCursor":0,"snapshotRequired":true}""")
      val currentRequests = fixture.requests().takeLast(2)

      fixture.reply(obsoleteRequests.first(), JSONObject())
      fixture.reply(obsoleteRequests.last(), JSONObject("""{"data":[{"id":"obsolete"}],"nextCursor":null}"""))
      assertTrue(fixture.resets.isEmpty())
      assertFalse(fixture.frames.any { it.optString("type") == "snapshotApplied" })

      currentRequests.forEach { request ->
        val archived = request.getJSONObject("params").getBoolean("archived")
        val id = if (archived) "current-archived" else "current-active"
        fixture.reply(request, JSONObject().put("data", JSONArray().put(JSONObject().put("id", id)))
          .put("nextCursor", JSONObject.NULL))
      }
      val persisted = JSONArray(fixture.store.checkpoint("snapshot-recovery").snapshotJson)
      assertEquals(2, persisted.length())
      assertEquals("current-active", persisted.getJSONObject(0).getJSONObject("thread").getString("id"))
      assertFalse(persisted.getJSONObject(0).getBoolean("archived"))
      assertEquals("current-archived", persisted.getJSONObject(1).getJSONObject("thread").getString("id"))
      assertTrue(persisted.getJSONObject(1).getBoolean("archived"))
      assertEquals(1, fixture.frames.count { it.optString("type") == "snapshotApplied" })
    } finally {
      fixture.close()
    }
  }
}
