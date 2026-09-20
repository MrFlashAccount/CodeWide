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
import com.facebook.react.modules.core.DeviceEventManagerModule
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import java.util.UUID

/** Exposes token-scoped microphone foreground ownership to the V1 Global Voice WebRTC adapter. */
class GlobalVoiceForegroundModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val activeTokens = mutableSetOf<String>()
  private var invalidated = false

  init {
    eventContext = context
  }

  override fun getName(): String = "CodeWideGlobalVoiceForeground"

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
  fun setLevel(level: Double) {
    VoiceCaptureForegroundService.updateOrbLevel(level)
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
    private const val OVERLAY_STOP_EVENT = "CodeWideGlobalVoiceOverlayStop"
    @Volatile private var eventContext: ReactApplicationContext? = null

    internal fun requestStopFromOverlay() {
      val activeContext = eventContext ?: return
      if (!activeContext.hasActiveReactInstance()) return
      activeContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(OVERLAY_STOP_EVENT, null)
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
