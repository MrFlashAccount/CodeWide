package dev.codewide.app.remote

internal enum class GlobalVoiceCaptureHealthEventKind {
  INTERRUPTED,
  RECOVERED,
}

internal data class GlobalVoiceCaptureHealthEvent(
  val audioRecordRunning: Boolean,
  val kind: GlobalVoiceCaptureHealthEventKind,
  val sampleAgeMs: Long,
  val screenInteractive: Boolean,
)

internal data class GlobalVoiceCaptureHealthSnapshot(
  val active: Boolean,
  val audioRecordRunning: Boolean,
  val expectedCapture: Boolean,
  val microphoneMuted: Boolean,
  val sampleAgeMs: Long?,
  val screenInteractive: Boolean,
)

/**
 * Detects a silent ADM capture stall without retaining audio or depending on the React lifecycle.
 * The foreground service owns scheduling; this owner only classifies timestamped state changes.
 */
internal class GlobalVoiceCaptureHealthOwner(
  private val nowMs: () -> Long,
  private val onEvent: (GlobalVoiceCaptureHealthEvent) -> Unit,
  private val interruptionTimeoutMs: Long = DEFAULT_INTERRUPTION_TIMEOUT_MS,
) {
  private val lock = Any()
  private var active = false
  private var audioRecordRunning = false
  private var expectedCapture = false
  private var expectedSinceMs = 0L
  private var interrupted = false
  private var lastSampleMs: Long? = null
  private var microphoneMuted = false
  private var screenInteractive = true

  fun acceptSamples() {
    val now = nowMs()
    val recovered = synchronized(lock) {
      lastSampleMs = now
      if (!interrupted) return@synchronized null
      interrupted = false
      event(GlobalVoiceCaptureHealthEventKind.RECOVERED, now, now)
    }
    if (recovered != null) onEvent(recovered)
  }

  fun check() {
    val now = nowMs()
    val event = synchronized(lock) {
      if (!active || !expectedCapture || microphoneMuted || interrupted) {
        return@synchronized null
      }
      val lastProgressMs = lastSampleMs ?: expectedSinceMs
      if (now - lastProgressMs < interruptionTimeoutMs) return@synchronized null
      interrupted = true
      event(GlobalVoiceCaptureHealthEventKind.INTERRUPTED, lastProgressMs, now)
    }
    if (event != null) onEvent(event)
  }

  fun setActive(nextActive: Boolean) {
    synchronized(lock) {
      if (active == nextActive) return
      active = nextActive
      resetProgress(nowMs())
    }
  }

  fun setAudioRecordRunning(running: Boolean) {
    synchronized(lock) {
      audioRecordRunning = running
      if (running) expectedSinceMs = nowMs()
    }
  }

  fun setExpectedCapture(expected: Boolean) {
    synchronized(lock) {
      if (expectedCapture == expected) return
      expectedCapture = expected
      resetProgress(nowMs())
    }
  }

  fun setMicrophoneMuted(muted: Boolean) {
    synchronized(lock) {
      if (microphoneMuted == muted) return
      microphoneMuted = muted
      resetProgress(nowMs())
    }
  }

  fun setScreenInteractive(interactive: Boolean): GlobalVoiceCaptureHealthSnapshot =
    synchronized(lock) {
      screenInteractive = interactive
      snapshot(nowMs())
    }

  fun snapshot(): GlobalVoiceCaptureHealthSnapshot = synchronized(lock) { snapshot(nowMs()) }

  private fun event(
    kind: GlobalVoiceCaptureHealthEventKind,
    lastProgressMs: Long,
    now: Long,
  ): GlobalVoiceCaptureHealthEvent =
    GlobalVoiceCaptureHealthEvent(
      audioRecordRunning = audioRecordRunning,
      kind = kind,
      sampleAgeMs = (now - lastProgressMs).coerceAtLeast(0L),
      screenInteractive = screenInteractive,
    )

  private fun resetProgress(now: Long) {
    expectedSinceMs = now
    interrupted = false
    lastSampleMs = null
  }

  private fun snapshot(now: Long): GlobalVoiceCaptureHealthSnapshot =
    GlobalVoiceCaptureHealthSnapshot(
      active = active,
      audioRecordRunning = audioRecordRunning,
      expectedCapture = expectedCapture,
      microphoneMuted = microphoneMuted,
      sampleAgeMs = lastSampleMs?.let { (now - it).coerceAtLeast(0L) },
      screenInteractive = screenInteractive,
    )

  private companion object {
    const val DEFAULT_INTERRUPTION_TIMEOUT_MS = 4_000L
  }
}
