package dev.codewide.app.remote

import java.util.concurrent.atomic.AtomicLong

/** Only counts and local peer correlation; never stores data-channel text or PCM. */
internal class GlobalVoiceIngressDiagnostics {
  private val messages = AtomicLong()
  private val nonText = AtomicLong()
  private val unrecognized = AtomicLong()
  private val started = AtomicLong()
  private val stopped = AtomicLong()
  private val connections = AtomicLong()
  private val pcm = AtomicLong()

  fun messageReceived() { messages.incrementAndGet() }
  fun nonText() { nonText.incrementAndGet() }
  fun unrecognized() { unrecognized.incrementAndGet() }
  fun connectionEvent() { connections.incrementAndGet() }
  fun pcmReceived() { pcm.incrementAndGet() }
  fun admitted(type: String) {
    when (type) {
      "input_audio_buffer.speech_started" -> started.incrementAndGet()
      "input_audio_buffer.speech_stopped" -> stopped.incrementAndGet()
    }
  }

  fun snapshot(): String = "messages=${messages.get()} nonText=${nonText.get()} " +
    "unrecognized=${unrecognized.get()} sourceStarted=${started.get()} sourceStopped=${stopped.get()} " +
    "connections=${connections.get()} pcmCallbacks=${pcm.get()}"
}
