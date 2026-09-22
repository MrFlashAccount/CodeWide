package dev.codewide.app.remote

import com.facebook.react.bridge.ReadableMap
import com.oney.WebRTCModule.WebRTCModule
import dev.codewide.app.rendering.VoiceAssistantOrbState
import org.json.JSONObject
import org.webrtc.RTCStatsReport

/** Adapts the existing RN WebRTC peer to validated, content-free native presentation facts. */
internal class GlobalVoiceWebRtcSource(
  private val peerId: Int,
  private val module: WebRTCModule,
  private val diagnostics: GlobalVoiceIngressDiagnostics = GlobalVoiceIngressDiagnostics(),
) : GlobalVoicePeerSource {
  override fun subscribe(
    onConnection: (VoiceAssistantOrbState) -> Unit,
    onEvent: (String) -> Unit,
  ): () -> Unit {
    val listener = object : WebRTCModule.NativePeerListener {
      override fun onEvent(eventName: String, params: ReadableMap) {
        when (eventName) {
          "dataChannelReceiveMessage" -> {
            diagnostics.messageReceived()
            if (params.getString("type") != "text") { diagnostics.nonText(); return }
            val type = globalVoiceRealtimeEventType(params.getString("data"))
            if (type == null) { diagnostics.unrecognized(); return }
            diagnostics.admitted(type)
            onEvent(type)
          }
          "peerConnectionStateChanged" -> {
            diagnostics.connectionEvent()
            val state = when (params.getString("connectionState")) {
              "connected" -> VoiceAssistantOrbState.LISTENING
              "failed" -> VoiceAssistantOrbState.ERROR
              "closed" -> VoiceAssistantOrbState.DISABLED
              else -> VoiceAssistantOrbState.CONNECTING
            }
            onConnection(state)
          }
        }
      }
    }
    module.addNativePeerListener(peerId, listener)
    return { module.removeNativePeerListener(peerId, listener) }
  }

  override fun requestPlayback(accept: (Double) -> Unit) {
    module.getNativePeerStats(peerId) { report -> accept(globalVoicePlaybackLevel(report)) }
  }
}

/** Only these protocol edges cross the native presentation boundary; text is never retained. */
internal fun globalVoiceRealtimeEventType(data: String?): String? {
  if (data == null || data.length > 262_144) return null
  val type = try { JSONObject(data).optString("type") } catch (_: org.json.JSONException) { return null }
  return when (type) {
    "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped",
    "response.created", "response.done", "output_audio_buffer.started",
    "output_audio_buffer.stopped", "output_audio_buffer.cleared" -> type
    else -> null
  }
}

internal fun globalVoicePlaybackLevel(report: RTCStatsReport): Double {
  var level = 0.0
  for (entry in report.statsMap.values) {
    if (entry.type != "inbound-rtp") continue
    val members = entry.members
    if (members["kind"] != "audio" && members["mediaType"] != "audio") continue
    // RTCStats exposes Object-valued members; the checked cast rejects nonnumeric external values.
    val candidate = (members["audioLevel"] as? Number)?.toDouble() ?: continue
    if (candidate.isFinite()) level = maxOf(level, candidate.coerceIn(0.0, 1.0))
  }
  return level
}
