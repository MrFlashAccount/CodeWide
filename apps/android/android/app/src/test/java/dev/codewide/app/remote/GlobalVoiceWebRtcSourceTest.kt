package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.webrtc.RTCStats
import org.webrtc.RTCStatsReport

class GlobalVoiceWebRtcSourceTest {
  @Test fun onlySemanticEdgesAreAdmittedWithoutTranscriptOrAudioContent() {
    assertEquals("input_audio_buffer.speech_started", globalVoiceRealtimeEventType(
      """{"type":"input_audio_buffer.speech_started"}"""))
    assertEquals("output_audio_buffer.stopped", globalVoiceRealtimeEventType(
      """{"type":"output_audio_buffer.stopped"}"""))
    for (data in listOf(null, "invalid", "null", "[]", """{"type":"response.text.delta","delta":"text"}""")) {
      assertNull(globalVoiceRealtimeEventType(data))
    }
  }

  @Test fun playbackUsesOnlyFiniteRemoteAudioLevels() {
    val report = RTCStatsReport(0, mapOf(
      "input" to RTCStats(0, "media-source", "input", mapOf("kind" to "audio", "audioLevel" to 1.0)),
      "video" to RTCStats(0, "inbound-rtp", "video", mapOf("kind" to "video", "audioLevel" to 1.0)),
      "invalid" to RTCStats(0, "inbound-rtp", "invalid", mapOf("kind" to "audio", "audioLevel" to Double.NaN)),
      "output" to RTCStats(0, "inbound-rtp", "output", mapOf("kind" to "audio", "audioLevel" to 0.7)),
    ))
    assertEquals(0.7, globalVoicePlaybackLevel(report), 0.0)
    assertEquals(0.0, globalVoicePlaybackLevel(RTCStatsReport(0, emptyMap())), 0.0)
  }
}
