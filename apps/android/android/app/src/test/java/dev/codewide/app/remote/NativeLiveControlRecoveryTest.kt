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
class NativeLiveControlRecoveryTest {
  private class Fixture {
    val frames = mutableListOf<JSONObject>()
    var writable = true
    val handler = Handler(Looper.getMainLooper())
    val engine = NativeProtocolEngine("home", NativeFrameStore(RuntimeEnvironment.getApplication()), handler, handler,
      sendFrame = { payload -> if (writable) frames.add(JSONObject(payload)); writable },
      resetTransport = {}, onLive = {}, onPortInventory = {}, telemetry = NativeTelemetryRecorder {})
    fun live() = engine.onFrame("""{"type":"status","status":"live"}""")
    fun methods(): List<String> = frames.mapNotNull { it.optJSONObject("request")?.optString("method") }
  }

  @Test fun offlineLiveControlsFailWithoutBeingSentToTheReplacementSession() {
    val fixture = Fixture()
    val methods = listOf("turn/interrupt", "thread/realtime/start", "thread/realtime/appendText", "thread/realtime/stop")
    methods.forEach { method ->
      var result: Result<Any?>? = null
      fixture.engine.rpc(method, JSONObject()) { result = it }
      assertTrue(result?.isFailure == true)
    }
    // Ordinary resource reads keep their existing recovery queue.
    fixture.engine.rpc("thread/read", JSONObject()) {}
    fixture.live()
    assertEquals(listOf("thread/read"), fixture.methods())
    fixture.engine.close()
  }

  @Test fun failedSendAlsoCannotDeferAnOldStopOrStart() {
    val fixture = Fixture()
    fixture.live()
    fixture.writable = false
    listOf("turn/interrupt", "thread/realtime/start", "thread/realtime/appendText", "thread/realtime/stop").forEach { method ->
      var result: Result<Any?>? = null
      fixture.engine.rpc(method, JSONObject()) { result = it }
      assertTrue(result?.isFailure == true)
    }
    fixture.writable = true
    fixture.live()
    assertTrue(fixture.methods().isEmpty())
    fixture.engine.close()
  }
}
