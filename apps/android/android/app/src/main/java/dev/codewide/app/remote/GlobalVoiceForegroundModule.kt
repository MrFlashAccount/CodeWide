package dev.codewide.app.remote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.net.Uri
import android.provider.Settings
import android.view.View
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import java.util.UUID
import com.oney.WebRTCModule.WebRTCModule

/** Exposes token-scoped microphone foreground ownership to the V1 Global Voice WebRTC adapter. */
// Class-based lookup in emitOverlayEvent requires this registration in bridgeless React Native.
@ReactModule(name = GlobalVoiceForegroundModule.NAME)
class GlobalVoiceForegroundModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val activeTokens = mutableSetOf<String>()
  private var invalidated = false

  init {
    eventContext = context
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun acquire(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    val token = UUID.randomUUID().toString()
    VoiceCaptureForegroundService.acquire(context, token, overlay = true) foreground@{ error ->
      if (error != null) {
        promise.reject("GLOBAL_VOICE_FOREGROUND_FAILED", error.message, error)
        return@foreground
      }
      val accepted = synchronized(this) {
        if (invalidated) false else activeTokens.add(token)
      }
      if (accepted) {
        promise.resolve(token)
      } else {
        VoiceCaptureForegroundService.release(token)
        promise.reject("GLOBAL_VOICE_FOREGROUND_CANCELLED", "Global Voice foreground ownership was cancelled")
      }
    }
  }

  @ReactMethod
  fun release(token: String, promise: Promise) {
    val owned = synchronized(this) { activeTokens.remove(token) }
    if (!owned) {
      promise.resolve(null)
      return
    }
    VoiceCaptureForegroundService.release(token) { promise.resolve(null) }
  }

  @ReactMethod
  fun observeWebRtc(peerId: Double, promise: Promise) {
    if (!peerId.isFinite() || peerId < 0 || peerId > Int.MAX_VALUE || peerId % 1.0 != 0.0 ||
      !synchronized(this) { !invalidated && activeTokens.isNotEmpty() }) {
      promise.reject("GLOBAL_VOICE_PEER_INVALID", "Global Voice peer ownership is unavailable")
      return
    }
    val module = context.getNativeModule(WebRTCModule::class.java)
    if (module == null) {
      promise.reject("GLOBAL_VOICE_PEER_UNAVAILABLE", "WebRTC module is unavailable")
      return
    }
    VoiceCaptureForegroundService.observeWebRtc(peerId.toInt(), module) { accepted ->
      if (accepted) promise.resolve(null)
      else promise.reject("GLOBAL_VOICE_PEER_RELEASED", "Global Voice foreground lease was released")
    }
  }

  @ReactMethod
  fun stopObservingWebRtc(peerId: Double) {
    if (!peerId.isFinite() || peerId < 0 || peerId > Int.MAX_VALUE || peerId % 1.0 != 0.0) return
    VoiceCaptureForegroundService.stopObservingWebRtc(peerId.toInt())
  }

  @ReactMethod
  fun setOrbStyle(style: String) {
    VoiceCaptureForegroundService.updateOrbStyle(VoiceAssistantOrbStyle.fromWireValue(style))
  }

  @ReactMethod
  fun setOrbState(state: String) {
    VoiceCaptureForegroundService.updateOrbState(VoiceAssistantOrbState.fromWireValue(state))
  }

  @ReactMethod
  fun setOrbReducedMotion(reducedMotion: Boolean) {
    VoiceCaptureForegroundService.updateOrbReducedMotion(reducedMotion)
  }

  @ReactMethod
  fun setOverlayChatTarget(connectionId: String?, threadId: String?) {
    val target = if (connectionId.isNullOrBlank() || threadId.isNullOrBlank()) null else {
      VoiceOverlayChatTarget(connectionId, threadId)
    }
    VoiceCaptureForegroundService.updateOverlayChatTarget(target)
  }

  @ReactMethod
  fun setMicrophoneMuted(muted: Boolean) {
    VoiceCaptureForegroundService.updateMicrophoneMuted(muted)
  }

  @ReactMethod
  fun setPlaybackLevel(token: String, level: Double) {
    if (!synchronized(this) { activeTokens.contains(token) }) return
    VoiceCaptureForegroundService.updatePlaybackLevel(level)
  }

  @ReactMethod
  fun setOrbLaunchOrigin(centerX: Double, centerY: Double, diameter: Double) {
    if (!centerX.isFinite() || !centerY.isFinite() || !diameter.isFinite() || diameter <= 0.0) return
    val density = context.resources.displayMetrics.density
    val appWindowOrigin = IntArray(2)
    context.currentActivity?.window?.decorView?.getLocationOnScreen(appWindowOrigin)
    VoiceCaptureForegroundService.updateOrbLaunchOrigin(
      VoiceOverlayLaunchOrigin(
        centerX.toFloat() * density + appWindowOrigin[0],
        centerY.toFloat() * density + appWindowOrigin[1],
        diameter.toFloat() * density,
      ),
    )
  }

  @ReactMethod
  fun clearOrbLaunchOrigin() {
    VoiceCaptureForegroundService.clearOrbLaunchOrigin()
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    promise.resolve(Settings.canDrawOverlays(context))
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    try {
      context.startActivity(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("GLOBAL_VOICE_OVERLAY_SETTINGS_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    synchronized(this) {
      invalidated = true
      activeTokens.forEach(VoiceCaptureForegroundService::release)
      activeTokens.clear()
    }
    if (eventContext === context) eventContext = null
    super.invalidate()
  }

  companion object {
    const val NAME = "CodeWideGlobalVoiceForeground"
    private const val CAPTURE_INTERRUPTED_EVENT = "CodeWideGlobalVoiceCaptureInterrupted"
    private const val OVERLAY_MICROPHONE_TOGGLE_EVENT = "CodeWideGlobalVoiceOverlayMicrophoneToggle"
    private const val OVERLAY_STOP_EVENT = "CodeWideGlobalVoiceOverlayStop"
    @Volatile private var eventContext: ReactApplicationContext? = null

    internal fun requestStopFromOverlay() {
      emitOverlayEvent(OVERLAY_STOP_EVENT)
    }

    internal fun requestMicrophoneToggleFromOverlay() {
      emitOverlayEvent(OVERLAY_MICROPHONE_TOGGLE_EVENT)
    }

    internal fun requestCaptureRecovery() {
      emitOverlayEvent(CAPTURE_INTERRUPTED_EVENT)
    }

    private fun emitOverlayEvent(eventName: String) {
      val activeContext = eventContext ?: return
      if (!activeContext.hasActiveReactInstance()) return
      val payload = if (eventName == OVERLAY_STOP_EVENT || eventName == OVERLAY_MICROPHONE_TOGGLE_EVENT) {
        val module = activeContext.getNativeModule(GlobalVoiceForegroundModule::class.java) ?: return
        val token = synchronized(module) { module.activeTokens.singleOrNull() } ?: return
        com.facebook.react.bridge.Arguments.createMap().apply { putString("token", token) }
      } else null
      activeContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, payload)
    }

    internal fun visibleOrbReturnTarget(): VoiceOverlayLaunchOrigin? {
      val origin = VoiceCaptureForegroundService.currentOrbLaunchOrigin() ?: return null
      val activeContext = eventContext ?: return null
      if (!activeContext.hasActiveReactInstance()) return null
      val activity = activeContext.currentActivity ?: return null
      if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) return null
      val decorView = activity.window.decorView
      if (decorView.windowVisibility != View.VISIBLE) return null
      val viewport = Rect()
      decorView.getWindowVisibleDisplayFrame(viewport)
      val radius = origin.diameter / 2f
      val fullyVisible = origin.centerX - radius >= viewport.left &&
        origin.centerX + radius <= viewport.right &&
        origin.centerY - radius >= viewport.top &&
        origin.centerY + radius <= viewport.bottom
      return if (fullyVisible) origin else null
    }
  }
}
