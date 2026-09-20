package dev.codewide.app.remote

import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor

internal interface MicrophoneAudioEffect {
  fun enableWhenControlled(): Boolean
  fun release()
}

internal interface MicrophoneEffectsPlatform {
  val acousticEchoCancelerSupported: Boolean
  val automaticGainControlSupported: Boolean
  val noiseSuppressorSupported: Boolean

  fun createAcousticEchoCanceler(audioSessionId: Int): MicrophoneAudioEffect?
  fun createAutomaticGainControl(audioSessionId: Int): MicrophoneAudioEffect?
  fun createNoiseSuppressor(audioSessionId: Int): MicrophoneAudioEffect?
}

private class AndroidMicrophoneAudioEffect(
  private val enable: () -> Boolean,
  private val releaseEffect: () -> Unit,
) : MicrophoneAudioEffect {
  override fun enableWhenControlled(): Boolean = enable()

  override fun release() = releaseEffect()
}

internal object AndroidMicrophoneEffectsPlatform : MicrophoneEffectsPlatform {
  override val acousticEchoCancelerSupported: Boolean
    get() = AcousticEchoCanceler.isAvailable()
  override val automaticGainControlSupported: Boolean
    get() = AutomaticGainControl.isAvailable()
  override val noiseSuppressorSupported: Boolean
    get() = NoiseSuppressor.isAvailable()

  override fun createAcousticEchoCanceler(audioSessionId: Int): MicrophoneAudioEffect? =
    AcousticEchoCanceler.create(audioSessionId)?.let { effect ->
      AndroidMicrophoneAudioEffect(
        enable = {
          if (!effect.hasControl()) false else {
            effect.enabled = true
            effect.enabled
          }
        },
        releaseEffect = effect::release,
      )
    }

  override fun createAutomaticGainControl(audioSessionId: Int): MicrophoneAudioEffect? =
    AutomaticGainControl.create(audioSessionId)?.let { effect ->
      AndroidMicrophoneAudioEffect(
        enable = {
          if (!effect.hasControl()) false else {
            effect.enabled = true
            effect.enabled
          }
        },
        releaseEffect = effect::release,
      )
    }

  override fun createNoiseSuppressor(audioSessionId: Int): MicrophoneAudioEffect? =
    NoiseSuppressor.create(audioSessionId)?.let { effect ->
      AndroidMicrophoneAudioEffect(
        enable = {
          if (!effect.hasControl()) false else {
            effect.enabled = true
            effect.enabled
          }
        },
        releaseEffect = effect::release,
      )
    }
}

internal data class OwnedMicrophoneAudioEffect(
  val enabled: Boolean,
  val effect: MicrophoneAudioEffect,
)

internal class PreparedMicrophoneEffects(
  val acousticEchoCancelerSupported: Boolean,
  val acousticEchoCanceler: OwnedMicrophoneAudioEffect?,
  val noiseSuppressor: OwnedMicrophoneAudioEffect?,
  val automaticGainControl: OwnedMicrophoneAudioEffect?,
) {
  private var released = false

  val acousticEchoCancelerEnabled: Boolean
    get() = acousticEchoCanceler?.enabled == true

  @Synchronized
  fun release() {
    if (released) return
    released = true
    var failure: Throwable? = null
    failure = releaseEffect(acousticEchoCanceler, failure)
    failure = releaseEffect(noiseSuppressor, failure)
    failure = releaseEffect(automaticGainControl, failure)
    failure?.let { throw it }
  }

  private fun releaseEffect(
    owned: OwnedMicrophoneAudioEffect?,
    previousFailure: Throwable?,
  ): Throwable? = try {
    owned?.effect?.release()
    previousFailure
  } catch (error: Throwable) {
    previousFailure ?: error
  }
}

internal class PreparedMicrophoneEffectsFactory(
  private val platform: MicrophoneEffectsPlatform,
  private val onFailure: (name: String, error: Throwable) -> Unit,
) {
  private data class EffectSetup(
    val supported: Boolean,
    val owned: OwnedMicrophoneAudioEffect?,
  )

  fun create(audioSessionId: Int): PreparedMicrophoneEffects {
    val acousticEchoCanceler = createEffect(
      "Acoustic echo cancellation",
      { platform.acousticEchoCancelerSupported },
    ) { platform.createAcousticEchoCanceler(audioSessionId) }
    val noiseSuppressor = createEffect("Noise suppression", { platform.noiseSuppressorSupported }) {
      platform.createNoiseSuppressor(audioSessionId)
    }
    val automaticGainControl = createEffect(
      "Automatic gain control",
      { platform.automaticGainControlSupported },
    ) { platform.createAutomaticGainControl(audioSessionId) }
    return PreparedMicrophoneEffects(
      acousticEchoCancelerSupported = acousticEchoCanceler.supported,
      acousticEchoCanceler = acousticEchoCanceler.owned,
      noiseSuppressor = noiseSuppressor.owned,
      automaticGainControl = automaticGainControl.owned,
    )
  }

  private fun createEffect(
    name: String,
    isSupported: () -> Boolean,
    create: () -> MicrophoneAudioEffect?,
  ): EffectSetup {
    var effect: MicrophoneAudioEffect? = null
    var supported = false
    return try {
      supported = isSupported()
      if (!supported) return EffectSetup(false, null)
      val created = create() ?: return EffectSetup(true, null)
      effect = created
      EffectSetup(true, OwnedMicrophoneAudioEffect(created.enableWhenControlled(), created))
    } catch (error: Throwable) {
      try {
        effect?.release()
      } catch (_: Throwable) {
        // The setup error remains authoritative after best-effort effect cleanup.
      }
      onFailure(name, error)
      EffectSetup(supported, null)
    }
  }
}
