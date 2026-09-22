package dev.codewide.app.remote

import dev.codewide.app.rendering.VoiceAssistantOrbState as State
import org.junit.Assert.assertEquals
import org.junit.Test

class GlobalVoicePresentationOwnerTest {
  @Test fun userSpeechWinsThinkingAndBargeInUntilVadEnds() {
    val owner = GlobalVoicePresentationOwner { 0L }
    owner.connected()
    owner.acceptPlayback(0.7)
    assertEquals(State.SPEAKING, owner.state())
    owner.acceptEvent("input_audio_buffer.speech_started")
    owner.acceptPhase(State.THINKING)
    owner.acceptPlayback(0.9)
    owner.acceptEvent("response.done")
    assertEquals(State.LISTENING, owner.state())
    owner.acceptEvent("input_audio_buffer.speech_stopped")
    assertEquals(State.THINKING, owner.state())
    owner.acceptPlayback(0.4)
    assertEquals(State.SPEAKING, owner.state())
  }

  @Test fun lifecycleGatesCannotBeMaskedByMediaOrStaleJsPublication() {
    for (gate in listOf(State.CONNECTING, State.ERROR, State.DISABLED)) {
      val owner = GlobalVoicePresentationOwner { 0L }
      owner.connected()
      owner.acceptEvent("input_audio_buffer.speech_started")
      owner.acceptPhase(gate)
      owner.acceptPhase(State.SPEAKING)
      owner.acceptEvent("input_audio_buffer.speech_started")
      owner.acceptPlayback(1.0)
      assertEquals(gate, owner.state())
      if (gate != State.CONNECTING) {
        owner.acceptPhase(State.CONNECTING)
        owner.connected()
        assertEquals(gate, owner.state())
      }
    }
  }

  @Test fun playbackOutlivesResponseDoneAndExpiresAfterRealSilence() {
    var now = 0L
    val owner = GlobalVoicePresentationOwner { now }
    owner.connected()
    owner.acceptEvent("response.created")
    assertEquals(State.THINKING, owner.state())
    owner.acceptPlayback(0.6)
    owner.acceptEvent("response.done")
    now = 400
    owner.acceptPlayback(0.0)
    assertEquals(State.SPEAKING, owner.state())
    now = 500
    owner.acceptPlayback(0.0)
    assertEquals(State.LISTENING, owner.state())
    owner.acceptEvent("output_audio_buffer.started")
    now = 1000
    assertEquals(State.SPEAKING, owner.state())
    owner.acceptEvent("output_audio_buffer.stopped")
    assertEquals(State.LISTENING, owner.state())
  }

  @Test fun muteAndStopClearSpeechAndStopRejectsLateMedia() {
    val owner = GlobalVoicePresentationOwner { 0L }
    owner.connected()
    owner.acceptEvent("input_audio_buffer.speech_started")
    owner.setMuted(true)
    owner.acceptEvent("input_audio_buffer.speech_started")
    owner.acceptPlayback(0.8)
    assertEquals(State.SPEAKING, owner.state())
    owner.stop()
    owner.acceptEvent("output_audio_buffer.started")
    owner.acceptPlayback(1.0)
    assertEquals(State.DISABLED, owner.state())
  }
}
