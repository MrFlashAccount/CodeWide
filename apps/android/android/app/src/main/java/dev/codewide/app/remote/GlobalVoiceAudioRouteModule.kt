package dev.codewide.app.remote

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.UUID

/** The ADM is process-owned, but input/mute/communication overrides exist only inside this lease. */
internal object GlobalVoiceAudioRouteRuntime {
  private lateinit var platform: AndroidVoiceInputRoutePlatform
  private lateinit var owner: VoiceInputRouteOwner
  private val main = Handler(Looper.getMainLooper())
  private var token: String? = null
  private var recording = false
  @Volatile var onChanged: (() -> Unit)? = null
  private val verify = Runnable { owner.verifyRouting(); onChanged?.invoke() }

  fun install(context: Context, adm: JavaAudioDeviceModule) {
    val audio = context.getSystemService(AudioManager::class.java)
    val preferences = context.getSharedPreferences("global_voice_audio_input", Context.MODE_PRIVATE)
    platform = AndroidVoiceInputRoutePlatform(audio, adm)
    owner = VoiceInputRouteOwner(
      platform,
      VoiceInputKind.parse(preferences.getString("kind", "system") ?: "system") ?: VoiceInputKind.SYSTEM,
    ) { kind ->
      check(preferences.edit().putString("kind", kind.wire).commit()) { "Could not save microphone preference" }
    }
    audio.registerAudioDeviceCallback(object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed()
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed()
    }, main)
    audio.registerAudioRecordingCallback(object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
        onChanged?.invoke()
      }
    }, main)
  }

  fun acquire(muted: Boolean): String {
    check(token == null) { "Global Voice audio route is already leased" }
    owner.start(muted)
    val next = UUID.randomUUID().toString()
    token = next
    changed()
    return next
  }

  fun setMuted(lease: String, muted: Boolean) {
    check(token == lease) { "Global Voice audio lease expired" }
    owner.setMuted(muted)
    changed()
  }

  fun release(lease: String) {
    if (token != lease) return
    token = null
    main.removeCallbacks(verify)
    try { owner.stop() } finally { onChanged?.invoke() }
  }

  fun select(kind: String, deviceId: Int?) {
    owner.select(requireNotNull(VoiceInputKind.parse(kind)) { "Unknown microphone preference" }, deviceId)
    changed()
  }

  fun recordingChanged(running: Boolean) {
    main.post { recording = running; changed() }
  }

  fun shutdown() { token?.let(::release) }

  private fun changed() {
    owner.devicesChanged()
    main.removeCallbacks(verify)
    if (owner.active && recording && !owner.muted && owner.selected != null) main.postDelayed(verify, 2000)
    onChanged?.invoke()
  }

  fun snapshot(): WritableMap = Arguments.createMap().apply {
    putString("preference", owner.preference.wire)
    putString("fallback", owner.fallback)
    putBoolean("active", owner.active)
    putBoolean("muted", owner.muted)
    putBoolean("bluetoothCoupled", owner.active && owner.selected?.kind?.communication == true)
    putMap("routedInput", if (owner.active && !owner.muted) platform.routedInput()?.let(::deviceMap) else null)
    putArray("devices", Arguments.createArray().apply { platform.devices().forEach { pushMap(deviceMap(it)) } })
  }

  private fun deviceMap(device: VoiceInputDevice): WritableMap = Arguments.createMap().apply {
    putInt("id", device.id)
    putString("kind", device.kind.wire)
    putString("label", device.label)
  }
}

internal class GlobalVoiceAudioRouteModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val main = Handler(Looper.getMainLooper())
  override fun getName() = "CodeWideGlobalVoiceAudioRoute"
  private val publishSnapshot = {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("CodeWideGlobalVoiceAudioRouteChanged", GlobalVoiceAudioRouteRuntime.snapshot())
      }
      Unit
  }

  override fun initialize() {
    super.initialize()
    GlobalVoiceAudioRouteRuntime.onChanged = publishSnapshot
  }

  override fun invalidate() {
    main.post {
      if (GlobalVoiceAudioRouteRuntime.onChanged === publishSnapshot) {
        GlobalVoiceAudioRouteRuntime.onChanged = null
        GlobalVoiceAudioRouteRuntime.shutdown()
      }
    }
    super.invalidate()
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
  @ReactMethod fun getSnapshot(promise: Promise) = complete(promise) { GlobalVoiceAudioRouteRuntime.snapshot() }
  @ReactMethod fun acquire(muted: Boolean, promise: Promise) = complete(promise) { GlobalVoiceAudioRouteRuntime.acquire(muted) }
  @ReactMethod fun release(token: String, promise: Promise) = complete(promise) { GlobalVoiceAudioRouteRuntime.release(token); null }
  @ReactMethod fun setMuted(token: String, muted: Boolean, promise: Promise) = complete(promise) { GlobalVoiceAudioRouteRuntime.setMuted(token, muted); null }
  @ReactMethod fun select(kind: String, deviceId: Double?, promise: Promise) = complete(promise) {
    require(deviceId == null || (deviceId.isFinite() && deviceId >= 0 && deviceId <= Int.MAX_VALUE && deviceId == deviceId.toInt().toDouble()))
    GlobalVoiceAudioRouteRuntime.select(kind, deviceId?.toInt())
    GlobalVoiceAudioRouteRuntime.snapshot()
  }

  private fun complete(promise: Promise, action: () -> Any?) {
    main.post {
      try { promise.resolve(action()) } catch (error: RuntimeException) {
        promise.reject("voice_input_failed", "Could not change the Voice Assistant microphone", error)
      }
    }
  }
}
