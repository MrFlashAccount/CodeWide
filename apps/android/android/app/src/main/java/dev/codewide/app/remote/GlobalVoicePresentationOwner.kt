package dev.codewide.app.remote

import dev.codewide.app.rendering.VoiceAssistantOrbState

/** Session facts arbitrate presentation; a renderer never infers speech from microphone energy. */
internal class GlobalVoicePresentationOwner(private val nowMs: () -> Long) {
  private var speechStarted = 0L
  private var speechStopped = 0L
  private var lastVadResult = "none"

  fun diagnostic(): String =
    "gate=${gate.wireValue} muted=$muted userSpeaking=$userSpeaking " +
      "speechStarted=$speechStarted speechStopped=$speechStopped vadResult=$lastVadResult " +
      "state=${state().wireValue}"

  private var gate = VoiceAssistantOrbState.CONNECTING
  private var userSpeaking = false
  private var muted = false
  private var responsePending = false
  private var outputPlaying = false
  private var playbackUntil = Long.MIN_VALUE
  private var backgroundThinking = false

  fun acceptPhase(state: VoiceAssistantOrbState) {
    // Terminal owners cannot be reopened by delayed phase/connection callbacks.
    if ((gate == VoiceAssistantOrbState.ERROR || gate == VoiceAssistantOrbState.DISABLED) &&
      state != VoiceAssistantOrbState.DISABLED) return
    when (state) {
      VoiceAssistantOrbState.CONNECTING, VoiceAssistantOrbState.ERROR, VoiceAssistantOrbState.DISABLED -> {
        gate = state
        clearSpeech()
      }
      else -> {
        // Only a connected peer may open the lifecycle gate. Delayed JS render publications
        // cannot resurrect a stopped or disconnected transport.
        backgroundThinking = state == VoiceAssistantOrbState.THINKING
      }
    }
  }

  fun connected() {
    if (gate == VoiceAssistantOrbState.CONNECTING) gate = VoiceAssistantOrbState.LISTENING
  }

  fun setMuted(value: Boolean) {
    muted = value
    if (value) userSpeaking = false
  }

  fun acceptEvent(type: String) {
    val vad = type == "input_audio_buffer.speech_started" || type == "input_audio_buffer.speech_stopped"
    if (type == "input_audio_buffer.speech_started") speechStarted += 1
    if (type == "input_audio_buffer.speech_stopped") speechStopped += 1
    if (vad) lastVadResult = when {
      gate != VoiceAssistantOrbState.LISTENING -> "rejected_gate"
      muted -> "rejected_muted"
      else -> "accepted"
    }
    if (gate != VoiceAssistantOrbState.LISTENING) return
    when (type) {
      "input_audio_buffer.speech_started" -> if (!muted) {
        userSpeaking = true
        outputPlaying = false
        playbackUntil = Long.MIN_VALUE
      }
      "input_audio_buffer.speech_stopped" -> if (!muted) {
        userSpeaking = false
        responsePending = true
      }
      "response.created" -> responsePending = true
      "response.done" -> responsePending = false
      "output_audio_buffer.started" -> {
        outputPlaying = true
        responsePending = false
      }
      "output_audio_buffer.stopped", "output_audio_buffer.cleared" -> {
        outputPlaying = false
        playbackUntil = Long.MIN_VALUE
      }
    }
  }

  fun acceptPlayback(level: Double) {
    if (gate != VoiceAssistantOrbState.LISTENING || userSpeaking) return
    if (level.isFinite() && level > 0.001) {
      playbackUntil = nowMs() + 450L
      responsePending = false
    }
  }

  fun state(): VoiceAssistantOrbState {
    if (gate != VoiceAssistantOrbState.LISTENING) return gate
    if (userSpeaking) return VoiceAssistantOrbState.LISTENING
    if (outputPlaying || nowMs() < playbackUntil) return VoiceAssistantOrbState.SPEAKING
    if (responsePending || backgroundThinking) return VoiceAssistantOrbState.THINKING
    return VoiceAssistantOrbState.LISTENING
  }

  fun stop() {
    gate = VoiceAssistantOrbState.DISABLED
    clearSpeech()
  }

  private fun clearSpeech() {
    userSpeaking = false
    responsePending = false
    outputPlaying = false
    playbackUntil = Long.MIN_VALUE
    backgroundThinking = false
  }
}
