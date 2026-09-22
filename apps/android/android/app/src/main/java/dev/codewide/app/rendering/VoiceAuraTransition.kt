package dev.codewide.app.rendering

/** Reacticx demo timing shared by the border and refraction, independent of viewport size. */
internal class VoiceAuraTransition {
  private enum class Phase { HIDDEN, OPENING, ACTIVE, CLOSING }

  private var phase = Phase.HIDDEN
  private var elapsed = 0f
  private var from = 0f
  private var fromOpacity = 1f

  var value = 0f
    private set
  var opacity = 0f
    private set
  val isAnimating: Boolean get() = phase == Phase.OPENING || phase == Phase.CLOSING
  val isVisible: Boolean get() = phase != Phase.HIDDEN

  fun setActive(active: Boolean, reducedMotion: Boolean) {
    if (reducedMotion) {
      phase = if (active) Phase.ACTIVE else Phase.HIDDEN
      value = if (active) 1f else 0f
      opacity = value
      return
    }
    val wasActive = phase == Phase.OPENING || phase == Phase.ACTIVE
    if (active == wasActive) return
    // Retarget from the displayed values; repeated level updates must not restart timing.
    from = value
    if (phase == Phase.HIDDEN) opacity = 1f
    fromOpacity = opacity
    elapsed = 0f
    phase = if (active) Phase.OPENING else Phase.CLOSING
  }

  fun advance(seconds: Float): Float {
    elapsed += seconds.coerceAtLeast(0f)
    when (phase) {
      Phase.OPENING -> {
        val progress = (elapsed / INTRO_SECONDS).coerceIn(0f, 1f)
        val eased = introBezier(progress)
        value = from + (1f - from) * eased
        opacity = fromOpacity + (1f - fromOpacity) * eased
        if (progress == 1f) phase = Phase.ACTIVE
      }
      Phase.CLOSING -> {
        val progress = (elapsed / OUTRO_SECONDS).coerceIn(0f, 1f)
        // Easing.out(Easing.quad), followed by withTiming's default inOut(quad) fade.
        value = from * (1f - progress) * (1f - progress)
        val fade = ((elapsed - OUTRO_SECONDS) / FADE_SECONDS).coerceIn(0f, 1f)
        val easedFade = if (fade < 0.5f) 2f * fade * fade
          else 1f - 2f * (1f - fade) * (1f - fade)
        opacity = fromOpacity * (1f - easedFade)
        if (fade == 1f) phase = Phase.HIDDEN
      }
      Phase.ACTIVE, Phase.HIDDEN -> Unit
    }
    return value
  }

  fun reset() {
    phase = Phase.HIDDEN
    elapsed = 0f
    value = 0f
    opacity = 0f
  }

  private fun introBezier(progress: Float): Float {
    if (progress == 0f || progress == 1f) return progress
    // Solve x(t) before evaluating y(t): using time directly as t is not CSS cubic-bezier.
    // Fixed iterations bound UI-thread work and avoid per-frame allocation.
    var low = 0f
    var high = 1f
    repeat(18) {
      val t = (low + high) * 0.5f
      val inverse = 1f - t
      val x = 0.75f * inverse * inverse * t + 0.75f * inverse * t * t + t * t * t
      if (x < progress) low = t else high = t
    }
    val t = (low + high) * 0.5f
    val inverse = 1f - t
    return 0.3f * inverse * inverse * t + 3f * inverse * t * t + t * t * t
  }

  internal companion object {
    // Reacticx Apple Intelligence showcase: cubic-bezier(0.25, 0.1, 0.25, 1).
    private const val INTRO_SECONDS = 1.1f
    private const val OUTRO_MILLIS = 520L
    private const val FADE_MILLIS = 200L
    internal const val CLOSE_DURATION_MILLIS = OUTRO_MILLIS + FADE_MILLIS
    private const val OUTRO_SECONDS = OUTRO_MILLIS / 1_000f
    private const val FADE_SECONDS = FADE_MILLIS / 1_000f
  }
}
