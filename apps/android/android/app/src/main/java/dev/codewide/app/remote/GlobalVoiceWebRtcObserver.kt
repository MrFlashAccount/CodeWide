package dev.codewide.app.remote

import android.os.Handler
import dev.codewide.app.rendering.VoiceAssistantOrbState

/** Content-free observation port; it neither owns nor closes the underlying media peer. */
internal interface GlobalVoicePeerSource {
  fun subscribe(onConnection: (VoiceAssistantOrbState) -> Unit, onEvent: (String) -> Unit): () -> Unit
  fun requestPlayback(accept: (Double) -> Unit)
}

/** Service-owned polling and event lifetime, independent of Activity and JS scheduling. */
internal class GlobalVoiceWebRtcObserver(
  val peerId: Int,
  private val source: GlobalVoicePeerSource,
  private val handler: Handler,
  private val onConnection: (VoiceAssistantOrbState) -> Unit,
  private val onEvent: (String) -> Unit,
  private val onPlayback: (Double) -> Unit,
) {
  private var closed = false
  private val poll = Runnable { requestStats() }
  private val unsubscribe = source.subscribe(
    { state -> handler.post { if (!closed) onConnection(state) } },
    { type -> handler.post { if (!closed) onEvent(type) } },
  )

  init { requestStats() }

  fun close() {
    if (closed) return
    closed = true
    handler.removeCallbacks(poll)
    unsubscribe()
  }

  private fun requestStats() {
    if (closed) return
    source.requestPlayback { level ->
      handler.post {
        if (!closed) {
          onPlayback(level)
          // Completion schedules the next request: at most one native getStats is in flight.
          handler.postDelayed(poll, 100L)
        }
      }
    }
  }
}
