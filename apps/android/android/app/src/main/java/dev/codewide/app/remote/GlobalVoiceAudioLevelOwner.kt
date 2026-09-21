package dev.codewide.app.remote

import android.media.AudioFormat
import kotlin.math.sqrt

internal data class GlobalVoiceAudioLevels(
  val input: Double,
  val playback: Double,
)

/**
 * Owns background-safe Global Voice audio envelopes next to the microphone foreground lifetime.
 * Input PCM is reduced synchronously and never retained; UI delivery is coalesced onto the main thread.
 */
internal class GlobalVoiceAudioLevelOwner(
  private val executeOnMain: (() -> Unit) -> Unit,
  private val nowNanos: () -> Long = System::nanoTime,
  private val publish: (GlobalVoiceAudioLevels) -> Unit,
) {
  private val schedulingLock = Any()
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
    }
    if (nextActive) return
    inputLevel = 0.0
    playbackLevel = 0.0
  }

  fun acceptInputPcm(audioFormat: Int, channelCount: Int, data: ByteArray) {
    if (!active || microphoneMuted) return
    val level = pcm16RootMeanSquare(audioFormat, channelCount, data) ?: return
    inputLevel = level
    schedulePublish()
  }

  fun acceptPlaybackLevel(level: Double) {
    if (!active) return
    playbackLevel = boundedLevel(level)
    schedulePublish()
  }

  fun setMicrophoneMuted(muted: Boolean) {
    synchronized(schedulingLock) {
      if (microphoneMuted == muted) return
      microphoneMuted = muted
      generation += 1
      dispatchQueued = false
      lastScheduledNanos = -MIN_PUBLISH_INTERVAL_NANOS
    }
    if (!muted) return
    inputLevel = 0.0
    if (active) schedulePublish()
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
      val shouldPublish = synchronized(schedulingLock) {
        if (generation != scheduledGeneration) return@synchronized false
        dispatchQueued = false
        active
      }
      if (shouldPublish) publish(GlobalVoiceAudioLevels(inputLevel, playbackLevel))
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
