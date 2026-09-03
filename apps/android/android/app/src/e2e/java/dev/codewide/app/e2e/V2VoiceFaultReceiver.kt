package dev.codewide.app.e2e

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.ReactApplication
import dev.codewide.app.remote.V2VoiceCaptureModule

/** Shell-only E2E control for faults that must cross the real Android Voice boundary. */
class V2VoiceFaultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) {
      reject("action-not-allowed")
      return
    }
    when (parseV2VoiceFaultMode(intent.getStringExtra(EXTRA_MODE))) {
      V2VoiceFaultMode.REVOKE_MICROPHONE_ON_KILL -> revokeMicrophoneOnKill(context)
      V2VoiceFaultMode.STOP_ACTIVE_CAPTURE -> stopActiveCapture(context)
      null -> reject("mode-not-allowed")
    }
  }

  private fun revokeMicrophoneOnKill(context: Context) {
    context.revokeSelfPermissionOnKill(Manifest.permission.RECORD_AUDIO)
    accept("microphone-revocation-scheduled")
  }

  private fun stopActiveCapture(context: Context) {
    val application = context.applicationContext as? ReactApplication
    val reactContext = application?.reactHost?.currentReactContext
    val capture = reactContext?.getNativeModule(V2VoiceCaptureModule::class.java)
    if (capture == null) {
      reject("voice-capture-unavailable")
      return
    }
    capture.stop()
    accept("active-capture-stop-dispatched")
  }

  private fun accept(message: String) {
    resultCode = Activity.RESULT_OK
    resultData = message
  }

  private fun reject(message: String) {
    resultCode = Activity.RESULT_CANCELED
    resultData = message
  }

  companion object {
    const val ACTION = "dev.codewide.app.e2e.VOICE_FAULT"
    const val EXTRA_MODE = "mode"
  }
}

internal enum class V2VoiceFaultMode(val wireValue: String) {
  REVOKE_MICROPHONE_ON_KILL("revoke-microphone-on-kill"),
  STOP_ACTIVE_CAPTURE("stop-active-capture"),
}

internal fun parseV2VoiceFaultMode(value: String?): V2VoiceFaultMode? =
  V2VoiceFaultMode.entries.singleOrNull { it.wireValue == value }
