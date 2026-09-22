package dev.codewide.app.remote

import android.media.AudioFormat
import kotlin.math.sqrt

internal data class GlobalVoiceAudioLevels(
  val input: Double,
  val playback: Double,
  val particlesInput: Double,
)

/**
 * Owns background-safe Global Voice audio envelopes next to the microphone foreground lifetime.
 * PCM is reduced synchronously; the Particles adapter retains only its transient FFT window.
 * UI delivery is coalesced onto the main thread; mute/Stop clear both input representations.
 */
internal class GlobalVoiceAudioLevelOwner(
  private val executeOnMain: (() -> Unit) -> Unit,
  private val nowNanos: () -> Long = System::nanoTime,
  private val publish: (GlobalVoiceAudioLevels) -> Unit,
) {
  private val schedulingLock = Any()
  private val particlesInput = ParticlesVoiceInputLevel()
  private var dispatchQueued = false
  private var generation = 0L
  private var lastScheduledNanos = -MIN_PUBLISH_INTERVAL_NANOS
  @Volatile private var active = false
  @Volatile private var inputLevel = 0.0
  @Volatile private var microphoneMuted = false
  @Volatile private var playbackLevel = 0.0

  fun setActive(nextActive: Boolean) {
    synchronized(schedulingLock) {
      if (active == nextActive) return
      active = nextActive
      generation += 1
      dispatchQueued = false
      lastScheduledNanos = -MIN_PUBLISH_INTERVAL_NANOS
      if (!nextActive) {
        inputLevel = 0.0
        playbackLevel = 0.0
        particlesInput.reset()
      }
    }
  }

  fun acceptInputPcm(audioFormat: Int, channelCount: Int, sampleRate: Int, data: ByteArray) {
    synchronized(schedulingLock) {
      if (!active || microphoneMuted || sampleRate <= 0 ||
        channelCount <= 0 || channelCount > data.size / Short.SIZE_BYTES ||
        data.size % (channelCount * Short.SIZE_BYTES) != 0
      ) return
      inputLevel = pcm16RootMeanSquare(audioFormat, channelCount, data) ?: return
      particlesInput.accept(channelCount, sampleRate, data)
    }
    schedulePublish()
  }

  fun acceptPlaybackLevel(level: Double) {
    synchronized(schedulingLock) {
      if (!active) return
      playbackLevel = boundedLevel(level)
    }
    schedulePublish()
  }

  fun setMicrophoneMuted(muted: Boolean) {
    synchronized(schedulingLock) {
      if (microphoneMuted == muted) return
      microphoneMuted = muted
      generation += 1
      dispatchQueued = false
      lastScheduledNanos = -MIN_PUBLISH_INTERVAL_NANOS
      if (muted) {
        inputLevel = 0.0
        particlesInput.reset()
      }
    }
    if (!muted) return
    if (active) schedulePublish()
  }

  fun diagnostic(): String = synchronized(schedulingLock) {
    "inputRms=$inputLevel particlesInput=${particlesInput.value} playback=$playbackLevel"
  }

  private fun schedulePublish() {
    val scheduledGeneration = synchronized(schedulingLock) {
      if (dispatchQueued) return
      val now = nowNanos()
      if (now - lastScheduledNanos < MIN_PUBLISH_INTERVAL_NANOS) return
      lastScheduledNanos = now
      dispatchQueued = true
      generation
    }
    executeOnMain {
      val levels = synchronized(schedulingLock) {
        if (generation != scheduledGeneration) return@synchronized null
        dispatchQueued = false
        if (active) GlobalVoiceAudioLevels(inputLevel, playbackLevel, particlesInput.value) else null
      }
      if (levels != null) publish(levels)
    }
  }

  private companion object {
    const val MIN_PUBLISH_INTERVAL_NANOS = 50_000_000L
  }
}

internal fun pcm16RootMeanSquare(
  audioFormat: Int,
  channelCount: Int,
  data: ByteArray,
): Double? {
  if (
    audioFormat != AudioFormat.ENCODING_PCM_16BIT ||
    channelCount <= 0 ||
    data.size < Short.SIZE_BYTES
  ) {
    return null
  }
  var sumOfSquares = 0.0
  var sampleCount = 0
  var offset = 0
  while (offset + 1 < data.size) {
    val low = data[offset].toInt() and 0xff
    val high = data[offset + 1].toInt() shl 8
    val sample = (high or low).toShort().toInt().toDouble()
    sumOfSquares += sample * sample
    sampleCount += 1
    offset += Short.SIZE_BYTES
  }
  if (sampleCount == 0) return null
  return boundedLevel(sqrt(sumOfSquares / sampleCount) / PCM_16_FULL_SCALE)
}

private fun boundedLevel(level: Double): Double =
  if (level.isFinite()) level.coerceIn(0.0, 1.0) else 0.0

private const val PCM_16_FULL_SCALE = 32_768.0
