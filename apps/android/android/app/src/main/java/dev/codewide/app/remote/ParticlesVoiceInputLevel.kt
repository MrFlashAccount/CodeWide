package dev.codewide.app.remote

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * VoiceOrbs useAudioLevel's visual input contract, not speech detection.
 * MIT source: amunozdev/voiceorbs@339ab42d98f6c4ffa03709ffa71f9f6965a2171a.
 * Reproduces AnalyserNode's 512-point Blackman FFT, -100..-30 dB bytes and voice-band
 * normalization. Advances at 60 Hz of captured audio, independent of Activity/render lifetime.
 * The caller serializes access. Only a bounded transient window is retained and reset on mute/Stop.
 */
internal class ParticlesVoiceInputLevel {
  private val samples = DoubleArray(SIZE)
  private val real = DoubleArray(SIZE)
  private val imaginary = DoubleArray(SIZE)
  private val spectrum = DoubleArray(SIZE / 2)
  private val window = DoubleArray(SIZE) { index ->
    val phase = 2.0 * PI * index / SIZE
    0.42 - 0.5 * cos(phase) + 0.08 * cos(2.0 * phase)
  }
  private val reversed = IntArray(SIZE) { Integer.reverse(it) ushr (32 - 9) }
  private val cosine = DoubleArray(SIZE / 2) { cos(-2.0 * PI * it / SIZE) }
  private val sine = DoubleArray(SIZE / 2) { sin(-2.0 * PI * it / SIZE) }
  private var sampleRate = 0
  private var cursor = 0
  private var tick = 0
  var value = 0.0
    private set

  fun reset() {
    samples.fill(0.0)
    real.fill(0.0)
    imaginary.fill(0.0)
    spectrum.fill(0.0)
    cursor = 0
    tick = 0
    sampleRate = 0
    value = 0.0
  }

  /** PCM16 frames have already been validated by the capture envelope owner. */
  fun accept(channelCount: Int, nextSampleRate: Int, data: ByteArray): Double {
    if (sampleRate != nextSampleRate) {
      reset()
      sampleRate = nextSampleRate
    }
    val frameBytes = channelCount * Short.SIZE_BYTES
    var offset = 0
    while (offset + frameBytes <= data.size) {
      var mono = 0.0
      repeat(channelCount) { channel ->
        val index = offset + channel * Short.SIZE_BYTES
        val sample = ((data[index].toInt() and 0xff) or (data[index + 1].toInt() shl 8)).toShort()
        mono += sample.toDouble() / 32_768.0
      }
      samples[cursor] = mono / channelCount
      cursor = (cursor + 1) % SIZE
      tick += TICKS_PER_SECOND
      if (tick >= sampleRate) {
        tick -= sampleRate
        analyse()
      }
      offset += frameBytes
    }
    return value
  }

  private fun analyse() {
    for (index in 0 until SIZE) {
      real[reversed[index]] = samples[(cursor + index) % SIZE] * window[index]
      imaginary[index] = 0.0
    }
    var width = 2
    while (width <= SIZE) {
      val half = width / 2
      val stride = SIZE / width
      for (start in 0 until SIZE step width) {
        for (index in 0 until half) {
          val left = start + index
          val right = left + half
          val phase = index * stride
          val re = cosine[phase] * real[right] - sine[phase] * imaginary[right]
          val im = sine[phase] * real[right] + cosine[phase] * imaginary[right]
          real[right] = real[left] - re
          imaginary[right] = imaginary[left] - im
          real[left] += re
          imaginary[left] += im
        }
      }
      width *= 2
    }
    val low = (85.0 * SIZE / sampleRate).roundToInt().coerceIn(1, SIZE / 2 - 1)
    val high = (3800.0 * SIZE / sampleRate).roundToInt().coerceIn(low + 1, SIZE / 2)
    var sum = 0.0
    var peak = 0.0
    for (bin in low until high) {
      spectrum[bin] = 0.7 * spectrum[bin] + 0.3 * hypot(real[bin], imaginary[bin]) / SIZE
      val db = 20.0 * log10(spectrum[bin])
      val byte = (255.0 * (db + 100.0) / 70.0).coerceIn(0.0, 255.0).toInt().toDouble()
      sum += byte
      peak = maxOf(peak, byte)
    }
    val energy = 0.65 * sum / (high - low) / 255.0 + 0.35 * peak / 255.0
    val normalized = ((energy - 0.14) / 0.62).coerceIn(0.0, 1.0)
    value += (normalized - value) * 0.15
  }

  private companion object {
    const val SIZE = 512
    const val TICKS_PER_SECOND = 60
  }
}
