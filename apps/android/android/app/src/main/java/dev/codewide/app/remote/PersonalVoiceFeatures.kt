package dev.codewide.app.remote

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Small CPU-only spectral descriptor used by the experimental personal speaker gate. */
internal object PersonalVoiceFeatures {
  const val SAMPLE_RATE = 16_000
  const val ACTIVITY_WINDOW_SAMPLES = 400
  private const val HOP_SAMPLES = 160
  private const val FFT_SIZE = 512
  private const val MEL_FILTERS = 24
  private const val CEPSTRAL_COEFFICIENTS = 12
  private const val MIN_VOICED_FRAMES = 8
  private const val MIN_RMS = 260.0

  fun decodePcm16(
    channelCount: Int,
    inputSampleRate: Int,
    data: ByteArray,
  ): ShortArray {
    if (channelCount <= 0 || inputSampleRate < SAMPLE_RATE || data.size < channelCount * 2) {
      return ShortArray(0)
    }
    val inputFrames = data.size / (channelCount * 2)
    val outputFrames = inputFrames * SAMPLE_RATE / inputSampleRate
    if (outputFrames <= 0) return ShortArray(0)
    val output = ShortArray(outputFrames)
    for (outputIndex in output.indices) {
      val inputIndex = outputIndex * inputSampleRate / SAMPLE_RATE
      var mixed = 0
      for (channel in 0 until channelCount) {
        val byteIndex = (inputIndex * channelCount + channel) * 2
        val low = data[byteIndex].toInt() and 0xff
        val high = data[byteIndex + 1].toInt()
        mixed += ((high shl 8) or low).toShort().toInt()
      }
      output[outputIndex] = (mixed / channelCount).toShort()
    }
    return output
  }

  fun embedding(samples: ShortArray): FloatArray? {
    if (samples.size < ACTIVITY_WINDOW_SAMPLES) return null
    val means = DoubleArray(CEPSTRAL_COEFFICIENTS + 1)
    val squared = DoubleArray(means.size)
    var voicedFrames = 0
    var offset = 0
    while (offset + ACTIVITY_WINDOW_SAMPLES <= samples.size) {
      val frame = frameFeatures(samples, offset)
      if (frame != null) {
        voicedFrames += 1
        for (index in means.indices) {
          means[index] += frame[index]
          squared[index] += frame[index] * frame[index]
        }
      }
      offset += HOP_SAMPLES
    }
    if (voicedFrames < MIN_VOICED_FRAMES) return null
    val result = FloatArray(means.size * 2)
    for (index in means.indices) {
      val mean = means[index] / voicedFrames
      val variance = max(0.0, squared[index] / voicedFrames - mean * mean)
      result[index] = mean.toFloat()
      result[index + means.size] = sqrt(variance).toFloat()
    }
    return result
  }

  fun similarity(left: FloatArray, right: FloatArray): Double {
    if (left.size != right.size || left.isEmpty()) return -1.0
    var squaredDistance = 0.0
    for (index in left.indices) {
      val scale = when (index) {
        CEPSTRAL_COEFFICIENTS -> 0.18
        in 0 until CEPSTRAL_COEFFICIENTS -> 0.6
        CEPSTRAL_COEFFICIENTS * 2 + 1 -> 0.08
        else -> 0.12
      }
      val difference = (left[index] - right[index]) / scale
      squaredDistance += difference * difference
    }
    return exp(-squaredDistance / left.size)
  }

  fun voiceActive(samples: ShortArray): Boolean =
    samples.size >= ACTIVITY_WINDOW_SAMPLES &&
      voiceActive(samples, samples.size - ACTIVITY_WINDOW_SAMPLES)

  private fun frameFeatures(samples: ShortArray, offset: Int): DoubleArray? {
    if (!voiceActive(samples, offset)) return null

    val real = DoubleArray(FFT_SIZE)
    val imaginary = DoubleArray(FFT_SIZE)
    for (index in 0 until ACTIVITY_WINDOW_SAMPLES) {
      val window = 0.54 - 0.46 * cos(2.0 * PI * index / (ACTIVITY_WINDOW_SAMPLES - 1))
      real[index] = samples[offset + index] * window
    }
    fft(real, imaginary)
    val power = DoubleArray(FFT_SIZE / 2 + 1)
    for (index in power.indices) {
      power[index] = real[index] * real[index] + imaginary[index] * imaginary[index]
    }
    val mel = melEnergies(power)
    val result = DoubleArray(CEPSTRAL_COEFFICIENTS + 1)
    for (coefficient in 1..CEPSTRAL_COEFFICIENTS) {
      var value = 0.0
      for (filter in mel.indices) {
        value += ln(max(mel[filter], 1.0)) *
          cos(PI * coefficient * (filter + 0.5) / MEL_FILTERS)
      }
      result[coefficient - 1] = value / MEL_FILTERS
    }
    result[CEPSTRAL_COEFFICIENTS] = ln(estimatePitch(samples, offset))
    return result
  }

  private fun voiceActive(samples: ShortArray, offset: Int): Boolean {
    var sumSquares = 0.0
    var crossings = 0
    var previous = samples[offset].toInt()
    for (index in 0 until ACTIVITY_WINDOW_SAMPLES) {
      val value = samples[offset + index].toInt()
      sumSquares += value.toDouble() * value
      if ((value >= 0) != (previous >= 0)) crossings += 1
      previous = value
    }
    val rms = sqrt(sumSquares / ACTIVITY_WINDOW_SAMPLES)
    val crossingRate = crossings.toDouble() / ACTIVITY_WINDOW_SAMPLES
    return rms >= MIN_RMS && crossingRate >= 0.005 && crossingRate <= 0.38
  }

  private fun melEnergies(power: DoubleArray): DoubleArray {
    val lowMel = hzToMel(80.0)
    val highMel = hzToMel(7_600.0)
    val bins = IntArray(MEL_FILTERS + 2) { index ->
      val mel = lowMel + (highMel - lowMel) * index / (MEL_FILTERS + 1)
      ((FFT_SIZE + 1) * melToHz(mel) / SAMPLE_RATE).toInt().coerceIn(0, power.lastIndex)
    }
    return DoubleArray(MEL_FILTERS) { filter ->
      val left = bins[filter]
      val center = max(left + 1, bins[filter + 1])
      val right = max(center + 1, bins[filter + 2]).coerceAtMost(power.lastIndex)
      var energy = 0.0
      for (bin in left until center.coerceAtMost(power.size)) {
        energy += power[bin] * (bin - left).toDouble() / (center - left)
      }
      for (bin in center until right) {
        energy += power[bin] * (right - bin).toDouble() / (right - center)
      }
      energy
    }
  }

  private fun estimatePitch(samples: ShortArray, offset: Int): Double {
    var bestLag = 80
    var bestCorrelation = Double.NEGATIVE_INFINITY
    for (lag in 40..266) {
      var correlation = 0.0
      for (index in lag until ACTIVITY_WINDOW_SAMPLES) {
        correlation += samples[offset + index].toDouble() * samples[offset + index - lag]
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation
        bestLag = lag
      }
    }
    return SAMPLE_RATE.toDouble() / bestLag
  }

  private fun fft(real: DoubleArray, imaginary: DoubleArray) {
    var target = 0
    for (index in 1 until FFT_SIZE) {
      var bit = FFT_SIZE shr 1
      while (target and bit != 0) {
        target = target xor bit
        bit = bit shr 1
      }
      target = target xor bit
      if (index < target) {
        val realValue = real[index]
        real[index] = real[target]
        real[target] = realValue
        val imaginaryValue = imaginary[index]
        imaginary[index] = imaginary[target]
        imaginary[target] = imaginaryValue
      }
    }
    var length = 2
    while (length <= FFT_SIZE) {
      val angle = -2.0 * PI / length
      val baseReal = cos(angle)
      val baseImaginary = sin(angle)
      var start = 0
      while (start < FFT_SIZE) {
        var weightReal = 1.0
        var weightImaginary = 0.0
        for (index in 0 until length / 2) {
          val even = start + index
          val odd = even + length / 2
          val oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary
          val oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal
          real[odd] = real[even] - oddReal
          imaginary[odd] = imaginary[even] - oddImaginary
          real[even] += oddReal
          imaginary[even] += oddImaginary
          val nextWeightReal = weightReal * baseReal - weightImaginary * baseImaginary
          weightImaginary = weightReal * baseImaginary + weightImaginary * baseReal
          weightReal = nextWeightReal
        }
        start += length
      }
      length = length shl 1
    }
  }

  private fun hzToMel(hz: Double): Double = 2_595.0 * kotlin.math.log10(1.0 + hz / 700.0)

  private fun melToHz(mel: Double): Double = 700.0 * (10.0.pow(mel / 2_595.0) - 1.0)
}
