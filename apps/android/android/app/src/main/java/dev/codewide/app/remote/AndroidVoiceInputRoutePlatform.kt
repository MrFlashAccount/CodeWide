package dev.codewide.app.remote

import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import org.webrtc.audio.JavaAudioDeviceModule

/** Android/ADM boundary. Preferred input is a request; recording configurations are the evidence. */
internal class AndroidVoiceInputRoutePlatform(
  private val audio: AudioManager,
  private val adm: JavaAudioDeviceModule,
) : VoiceInputRoutePlatform {
  override fun devices(): List<VoiceInputDevice> = audio.getDevices(AudioManager.GET_DEVICES_INPUTS)
    .mapNotNull(::inputDevice).sortedWith(compareBy({ it.kind.ordinal }, { it.label }, { it.id }))

  override fun routedInput(): VoiceInputDevice? {
    // RECORD_AUDIO exposes our own configurations. The V1 microphone lease excludes dictation
    // and profile enrollment while Global Voice owns capture. Ambiguity stays unknown.
    val configurations = audio.activeRecordingConfigurations.filter {
      it.clientAudioSource == MediaRecorder.AudioSource.VOICE_COMMUNICATION && !it.isClientSilenced
    }
    return configurations.singleOrNull()?.audioDevice?.let(::inputDevice)
  }

  override fun preferInput(id: Int?) {
    val device = if (id == null) null else audio.getDevices(AudioManager.GET_DEVICES_INPUTS)
      .find { it.id == id } ?: throw IllegalStateException("Microphone disconnected")
    // The pinned Jitsi 124 ADM accepts null and forwards it to AudioRecord.setPreferredDevice.
    adm.setPreferredInputDevice(device)
  }

  override fun muteCapture(muted: Boolean) = adm.setMicrophoneMute(muted)

  override fun communicationRoute(inputId: Int): (() -> Unit)? {
    // A persisted Bluetooth preference can outlive BLUETOOTH_CONNECT permission.
    // Device enumeration/address reads may throw before any route override exists.
    return try { requestCommunicationRoute(inputId) } catch (_: SecurityException) { null }
  }

  private fun requestCommunicationRoute(inputId: Int): (() -> Unit)? {
    if (Build.VERSION.SDK_INT < 31) return null
    val input = audio.getDevices(AudioManager.GET_DEVICES_INPUTS).find { it.id == inputId } ?: return null
    val outputs = audio.availableCommunicationDevices.filter { it.type == input.type }
    val output = outputs.find { it.address == input.address && it.address.isNotBlank() }
      ?: outputs.singleOrNull() ?: return null
    val previousMode = audio.mode
    val previousCommunication = audio.communicationDevice
    val restore = {
      // Do not overwrite a route taken over by another call while our lease was alive.
      try {
        if (audio.communicationDevice?.id == output.id || audio.communicationDevice == null) {
          audio.clearCommunicationDevice()
          if (previousMode == AudioManager.MODE_IN_COMMUNICATION && previousCommunication != null &&
            audio.availableCommunicationDevices.any { it.id == previousCommunication.id }) {
            audio.setCommunicationDevice(previousCommunication)
          }
        }
      } finally {
        if (audio.mode == AudioManager.MODE_IN_COMMUNICATION) audio.mode = previousMode
      }
    }
    try {
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      if (!audio.setCommunicationDevice(output)) {
        restore()
        return null
      }
    } catch (_: SecurityException) {
      restore()
      return null
    }
    return restore
  }

  private fun inputDevice(device: AudioDeviceInfo): VoiceInputDevice? {
    if (!device.isSource) return null
    val kind = when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> VoiceInputKind.BUILTIN
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> VoiceInputKind.WIRED
      AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY,
      AudioDeviceInfo.TYPE_USB_HEADSET -> VoiceInputKind.USB
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> VoiceInputKind.BLUETOOTH
      AudioDeviceInfo.TYPE_BLE_HEADSET -> VoiceInputKind.BLE
      else -> return null
    }
    return VoiceInputDevice(device.id, kind, device.productName.toString())
  }
}
