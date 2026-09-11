package dev.codewide.app.rendering

import kotlin.math.exp
import kotlin.math.log10

/** Frame-rate-independent speech envelope. PCM RMS is linear, not a decibel value. */
internal class VoiceAuraEnvelope {
  private var target = 0f
  var value = 0f
    private set

  fun accept(rms: Double) {
    val finiteRms = if (rms.isFinite()) rms.coerceIn(0.0, 1.0) else 0.0
    val decibels = 20.0 * log10(finiteRms.coerceAtLeast(0.00001))
    val level = ((decibels + 55.0) / 49.0).coerceIn(0.0, 1.0).toFloat()
    target = level * level * (3f - 2f * level)
  }

  fun advance(seconds: Float): Float {
    val duration = if (target > value) 0.045f else 0.24f
    val response = (1.0 - exp(-seconds.coerceAtLeast(0f).toDouble() / duration)).toFloat()
    value += (target - value) * response
    return value
  }

  fun reset() {
    target = 0f
    value = 0f
  }
}
