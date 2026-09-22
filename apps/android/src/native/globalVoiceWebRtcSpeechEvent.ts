/** Admits only content-free VAD edges from the session-owned WebRTC data channel. */
export function globalVoiceWebRtcUserSpeaking(data: unknown): boolean | null {
  if (typeof data !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || !("type" in value)) {
    return null;
  }
  if (value.type === "input_audio_buffer.speech_started") {
    return true;
  }
  if (value.type === "input_audio_buffer.speech_stopped") {
    return false;
  }
  return null;
}
