package dev.codewide.app.diagnostics

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/** Bridge ownership ends with the runtime; Activity owns the window observation lifecycle. */
class WindowDiagnosticsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "CodeWideWindowDiagnostics"

  @ReactMethod
  fun getRecording(promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(WindowDiagnostics.isRecording()) }
  }

  @ReactMethod
  fun setRecording(enabled: Boolean, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        promise.resolve(WindowDiagnostics.setRecording(enabled))
      } catch (error: Exception) {
        promise.reject("WINDOW_DIAGNOSTICS", "Could not change window diagnostics", error)
      }
    }
  }

  @ReactMethod
  fun captureReport(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        promise.resolve(WindowDiagnostics.report())
      } catch (error: Exception) {
        promise.reject("WINDOW_DIAGNOSTICS", "Could not capture window diagnostics", error)
      }
    }
  }

}
