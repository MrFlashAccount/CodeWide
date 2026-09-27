package dev.codewide.app.remote

import android.os.Handler
import android.os.Looper
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
class TransportRouteDeliveryTest {
  private class Fixture {
    val network = DefaultNetworkState<String>()
    val route = TransportRouteRecovery()
    val store = NativeFrameStore(RuntimeEnvironment.getApplication())
    val sent = mutableListOf<JSONObject>()
    var socketOpen = false
    var attempts = 0
    var replacements = 0
    val engine = NativeProtocolEngine("route-delivery", store, Handler(Looper.getMainLooper()),
      Handler(Looper.getMainLooper()), sendFrame = { text ->
        if (socketOpen) sent.add(JSONObject(text))
        socketOpen
      }, resetTransport = { error("Unexpected protocol reset: $it") }, onLive = {},
      onPortInventory = {}, telemetry = NativeTelemetryRecorder {})

    fun available(id: String) {
      if (!network.available(id)) return
      when (route.available(network.epoch, socketOpen)) {
        TransportRouteRecovery.Action.KEEP -> Unit
        TransportRouteRecovery.Action.REPLACE -> { replacements++; disconnect(); connect() }
        TransportRouteRecovery.Action.CONNECT -> connect()
      }
    }

    private fun connect() {
      attempts++
      route.attemptStarted(network.epoch)
      socketOpen = true
      engine.onSocketOpen()
    }

    fun lost(id: String) {
      if (network.lost(id)) disconnect()
    }

    private fun disconnect() {
      socketOpen = false
      engine.onSocketClosed("Network unavailable")
    }

    fun hello(head: Long) {
      engine.onFrame("""{"type":"hello","headCursor":$head,"snapshotRequired":false}""")
      engine.onFrame("""{"type":"status","status":"live"}""")
    }

    fun caughtUp(head: Long) {
      engine.onFrame("""{"type":"caughtUp","cursor":$head}""")
    }

    fun message(cursor: Long, text: String) {
      engine.onFrame(JSONObject().put("type", "event").put("cursor", cursor)
        .put("payload", JSONObject().put("method", "item/agentMessage/delta")
          .put("params", JSONObject().put("threadId", "thread").put("turnId", "turn")
            .put("itemId", "answer").put("delta", text))).toString())
    }
  }

  @Test fun newDefaultBeforeOldLostReplacesOnceAndRetainsUnacknowledgedIncomingFrames() {
    handoff(false)
  }

  @Test fun oldLostBeforeNewDefaultConnectsOnceAndRetainsUnacknowledgedIncomingFrames() {
    handoff(true)
  }

  private fun handoff(lostFirst: Boolean) {
    val test = Fixture()
    try {
      test.available("wifi")
      test.hello(0)
      test.caughtUp(0)
      test.message(1, "before handoff")
      repeat(100) {
        test.network.capabilities("wifi", it % 2 == 0, false)
        test.engine.onNetworkObservation(test.network.availability, test.network.epoch)
        assertEquals(TransportRouteRecovery.Action.KEEP, test.route.available(test.network.epoch, true))
      }
      assertEquals(1, test.attempts)
      var oldRpc: Result<Any?>? = null
      test.engine.rpc("companion/queue/put", JSONObject()) { oldRpc = it }
      assertNull(oldRpc)
      if (lostFirst) test.lost("wifi")
      test.available("cellular")
      test.lost("wifi")
      test.available("cellular")
      assertEquals(2, test.attempts)
      assertEquals(if (lostFirst) 0 else 1, test.replacements)
      assertTrue(oldRpc?.isFailure == true)
      // Closing flushes frames durably before the replacement hello chooses its cursor.
      assertEquals(1L, test.sent.last { it.optString("type") == "hello" }.getLong("cursor"))
      test.hello(2)
      test.message(1, "duplicate replay")
      test.message(2, "after handoff")
      test.caughtUp(2)
      val page = test.store.committedFrames("route-delivery", null, 128, 1_048_576)
      assertEquals(listOf(1L, 2L), page.frames.map { it.cursor })
      assertEquals(listOf("before handoff", "after handoff"), page.frames.map {
        JSONObject(it.payload).getJSONObject("payload").getJSONObject("params").getString("delta")
      })
      assertEquals(2L, test.sent.last { it.optString("type") == "ack" }.getLong("cursor"))
      // A replacement RPC is acknowledged by its own response, never by local staging.
      var accepted = false
      test.engine.rpc("companion/queue/put", JSONObject()) { accepted = it.isSuccess }
      assertFalse(accepted)
      val request = test.sent.last { it.optString("type") == "rpc" }.getJSONObject("request")
      test.engine.onFrame(JSONObject().put("type", "rpc").put("response",
        JSONObject().put("id", request.get("id")).put("result", JSONObject())).toString())
      assertTrue(accepted)
    } finally {
      test.engine.close()
    }
  }
}
