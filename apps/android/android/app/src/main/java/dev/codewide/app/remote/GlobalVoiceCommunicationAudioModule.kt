package dev.codewide.app.remote

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID

internal interface CommunicationAudioMode {
  fun currentMode(): Int
  fun setMode(value: Int)
}

internal data class CommunicationAudioDevice(val id: Int, val type: Int)

internal interface CommunicationAudioRoute {
  fun available(): List<CommunicationAudioDevice>
  fun clear()
  fun currentDevice(): CommunicationAudioDevice?
  fun select(deviceId: Int): Boolean
  fun startObserving(onChanged: () -> Unit)
  fun stopObserving()
}

internal class CommunicationAudioSessionOwner(
  private val audioMode: CommunicationAudioMode,
  private val audioRoute: CommunicationAudioRoute,
  private val communicationMode: Int,
  private val earpieceType: Int,
  private val newToken: () -> String,
  private val speakerType: Int,
) {
  private data class ActiveSession(
    val previousDeviceId: Int?,
    val previousMode: Int,
    var speakerSelected: Boolean,
    val token: String,
  )

  private var active: ActiveSession? = null

  @Synchronized
  fun acquire(): String {
    check(active == null) { "Global Voice communication audio is already active" }
    val previousMode = audioMode.currentMode()
    val previousDeviceId = audioRoute.currentDevice()?.id
    val token = newToken()
    val session = ActiveSession(previousDeviceId, previousMode, false, token)
    try {
      audioMode.setMode(communicationMode)
      active = session
      audioRoute.startObserving(::refreshRoute)
      refreshRoute()
    } catch (error: Throwable) {
      active = null
      try {
        releaseSession(session)
      } catch (_: Throwable) {
        // The acquisition error remains authoritative after one best-effort restore.
      }
      throw error
    }
    return token
  }

  @Synchronized
  fun refreshRoute() {
    val session = active ?: return
    val devices = audioRoute.available()
    val externalAvailable = devices.any { !isBuiltIn(it) }
    if (externalAvailable) {
      if (session.speakerSelected) {
        audioRoute.clear()
        session.speakerSelected = false
      }
      return
    }
    if (audioRoute.currentDevice()?.type == speakerType) return
    val speaker = devices.firstOrNull { it.type == speakerType } ?: return
    session.speakerSelected = audioRoute.select(speaker.id)
  }

  @Synchronized
  fun release(token: String): Boolean {
    val session = active ?: return false
    if (session.token != token) return false
    active = null
    releaseSession(session)
    return true
  }

  @Synchronized
  fun close() {
    val session = active ?: return
    active = null
    releaseSession(session)
  }

  private fun isBuiltIn(device: CommunicationAudioDevice): Boolean =
    device.type == earpieceType || device.type == speakerType

  private fun releaseSession(session: ActiveSession) {
    var failure: Throwable? = null
    fun attempt(action: () -> Unit) {
      try {
        action()
      } catch (error: Throwable) {
        if (failure == null) failure = error
      }
    }
    attempt(audioRoute::stopObserving)
    if (session.speakerSelected) {
      attempt {
        val previous = if (session.previousMode == communicationMode) {
          session.previousDeviceId?.let { previousId ->
            audioRoute.available().firstOrNull { it.id == previousId }
          }
        } else null
        if (previous == null || !audioRoute.select(previous.id)) audioRoute.clear()
      }
    }
    attempt { audioMode.setMode(session.previousMode) }
    failure?.let { throw it }
  }
}

private class AndroidCommunicationAudioPlatform(context: Context) :
  CommunicationAudioMode,
  CommunicationAudioRoute {
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private var deviceCallback: AudioDeviceCallback? = null

  override fun available(): List<CommunicationAudioDevice> =
    audioManager.availableCommunicationDevices.map { it.toCommunicationDevice() }

  override fun clear() = audioManager.clearCommunicationDevice()

  override fun currentMode(): Int = audioManager.mode

  override fun currentDevice(): CommunicationAudioDevice? =
    audioManager.communicationDevice?.toCommunicationDevice()

  override fun select(deviceId: Int): Boolean {
    val device = audioManager.availableCommunicationDevices.firstOrNull { it.id == deviceId }
      ?: return false
    return audioManager.setCommunicationDevice(device)
  }

  override fun setMode(value: Int) {
    audioManager.mode = value
  }

  override fun startObserving(onChanged: () -> Unit) {
    check(deviceCallback == null) { "Communication audio route observer is already active" }
    val callback = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = onChanged()
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = onChanged()
    }
    deviceCallback = callback
    audioManager.registerAudioDeviceCallback(callback, mainHandler)
  }

  override fun stopObserving() {
    val callback = deviceCallback ?: return
    deviceCallback = null
    audioManager.unregisterAudioDeviceCallback(callback)
  }

  private fun AudioDeviceInfo.toCommunicationDevice(): CommunicationAudioDevice =
    CommunicationAudioDevice(id, type)
}

/** Owns the scoped Android communication mode used only by interactive Global Voice WebRTC. */
class GlobalVoiceCommunicationAudioModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  private val audio = AndroidCommunicationAudioPlatform(context)
  private val owner = CommunicationAudioSessionOwner(
    audio,
    audio,
    AudioManager.MODE_IN_COMMUNICATION,
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
    { UUID.randomUUID().toString() },
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
  )

  override fun getName(): String = "CodeWideGlobalVoiceCommunicationAudio"

  @ReactMethod
  fun acquire(promise: Promise) {
    try {
      promise.resolve(owner.acquire())
    } catch (error: Throwable) {
      promise.reject("COMMUNICATION_AUDIO_ACQUIRE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun release(token: String, promise: Promise) {
    try {
      promise.resolve(owner.release(token))
    } catch (error: Throwable) {
      promise.reject("COMMUNICATION_AUDIO_RELEASE_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    try {
      owner.close()
    } finally {
      super.invalidate()
    }
  }
}
