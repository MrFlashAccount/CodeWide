package dev.codewide.app.remote

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class V2TerminalModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val manager = V2TerminalSessionManager(
    { CodexConnectionService.instance ?: error("Connection service is not running") },
    ::emitRecord,
    ::emitFailure,
  )

  override fun getName(): String = "CodeWideV2Terminal"

  @ReactMethod
  fun open(sessionId: String, savedServerId: String, threadId: String, generation: String, cwd: String?, cols: Double, rows: Double, offset: String, create: Boolean, promise: Promise) {
    try {
      val colsValue = cols.toInt()
      val rowsValue = rows.toInt()
      require(cols == colsValue.toDouble() && rows == rowsValue.toDouble()) { "Terminal size must be integral" }
      val record = V2TerminalFrameCodec.open(sessionId, threadId, generation, cwd, colsValue, rowsValue, offset, create)
      manager.open(sessionId, savedServerId, record)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("V2_TERMINAL_OPEN_FAILED", error.message, error)
    }
  }

  @ReactMethod fun input(sessionId: String, data: String) = manager.input(sessionId, data)
  @ReactMethod fun resize(sessionId: String, cols: Double, rows: Double) = manager.resize(sessionId, cols.toInt(), rows.toInt())
  @ReactMethod fun close(sessionId: String) = manager.close(sessionId)
  @ReactMethod fun closeSavedServer(savedServerId: String) = manager.closeSavedServer(savedServerId)
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    manager.closeAll()
    super.invalidate()
  }

  private fun emitRecord(sessionId: String, record: V2TerminalServerRecord) = emit(Arguments.createMap().apply {
    putString("sessionId", sessionId)
    putString("type", record.type)
    putString("record", record.json)
  })

  private fun emitFailure(sessionId: String, reason: String) = emit(Arguments.createMap().apply {
    putString("sessionId", sessionId)
    putString("type", "transportFailure")
    putString("reason", reason.take(64))
  })

  private fun emit(payload: com.facebook.react.bridge.WritableMap) {
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, payload)
      }
    }
  }

  private companion object {
    const val EVENT = "codewideV2Terminal"
  }
}
