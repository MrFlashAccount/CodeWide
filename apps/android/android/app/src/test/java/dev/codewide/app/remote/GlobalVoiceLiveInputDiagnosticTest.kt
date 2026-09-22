package dev.codewide.app.remote

import dev.codewide.app.rendering.VoiceAssistantOrbState as State
import org.junit.Assert.*
import org.junit.Test

class GlobalVoiceLiveInputDiagnosticTest {
  @Test fun validatedSpeechTemporarilyOverridesThinkingAndPlaybackWithSeparatePcmEvidence() {
    val ingress = GlobalVoiceIngressDiagnostics()
    val owner = GlobalVoicePresentationOwner { 0L }
    owner.connected()
    owner.acceptPhase(State.THINKING)
    owner.acceptPlayback(0.8)
    assertEquals(State.SPEAKING, owner.state())
    ingress.pcmReceived()
    val start = requireNotNull(globalVoiceRealtimeEventType("""{"type":"input_audio_buffer.speech_started"}"""))
    ingress.messageReceived()
    ingress.admitted(start)
    owner.acceptEvent(start)
    owner.acceptPhase(State.THINKING)
    owner.acceptPlayback(0.9)
    assertEquals(State.LISTENING, owner.state())
    assertTrue(owner.diagnostic().contains("userSpeaking=true speechStarted=1 speechStopped=0 vadResult=accepted"))
    assertTrue(ingress.snapshot().contains("sourceStarted=1 sourceStopped=0"))
    assertTrue(ingress.snapshot().contains("pcmCallbacks=1"))
    val stop = requireNotNull(globalVoiceRealtimeEventType("""{"type":"input_audio_buffer.speech_stopped"}"""))
    owner.acceptEvent(stop)
    assertEquals(State.THINKING, owner.state())
    owner.acceptPlayback(0.3)
    assertEquals(State.SPEAKING, owner.state())
  }

  @Test fun diagnosticsDistinguishAbsentVadFromGateAndMuteRejectionWithoutLeakingText() {
    val ingress = GlobalVoiceIngressDiagnostics()
    ingress.pcmReceived()
    ingress.messageReceived()
    assertNull(globalVoiceRealtimeEventType("""{"type":"conversation.item.input_audio_transcription.completed","transcript":"PRIVATE"}"""))
    ingress.unrecognized()
    assertTrue(ingress.snapshot().contains("sourceStarted=0"))
    assertFalse(ingress.snapshot().contains("PRIVATE"))
    val owner = GlobalVoicePresentationOwner { 0L }
    owner.acceptEvent("input_audio_buffer.speech_started")
    assertTrue(owner.diagnostic().contains("vadResult=rejected_gate"))
    owner.connected()
    owner.setMuted(true)
    owner.acceptEvent("input_audio_buffer.speech_started")
    assertTrue(owner.diagnostic().contains("muted=true"))
    assertTrue(owner.diagnostic().contains("vadResult=rejected_muted"))
    owner.setMuted(false)
    owner.acceptEvent("input_audio_buffer.speech_started")
    assertTrue(owner.diagnostic().contains("speechStarted=3"))
    assertTrue(owner.diagnostic().contains("vadResult=accepted state=listening"))
    owner.stop()
    owner.acceptEvent("input_audio_buffer.speech_started")
    assertTrue(owner.diagnostic().contains("gate=disabled"))
    assertTrue(owner.diagnostic().contains("vadResult=rejected_gate"))
  }
}
