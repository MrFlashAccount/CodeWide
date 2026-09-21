import { describe, expect, it } from "vitest";

import {
  globalVoiceWebRtcPlaybackLevel,
  globalVoiceWebRtcTransportSnapshot,
} from "../src/native/globalVoiceWebRtcAudioLevel";

describe("Global Voice WebRTC playback level", () => {
  it("selects only the highest bounded inbound audio level", () => {
    const report = new Map([
      ["microphone", { audioLevel: 0.95, kind: "audio", type: "media-source" }],
      ["video", { audioLevel: 0.99, kind: "video", type: "inbound-rtp" }],
      ["quiet-assistant", { audioLevel: 0.2, kind: "audio", type: "inbound-rtp" }],
      ["active-assistant", { audioLevel: 1.4, mediaType: "audio", type: "inbound-rtp" }],
    ]);

    expect(globalVoiceWebRtcPlaybackLevel(report)).toBe(1);
  });

  it("falls back to silence for an empty or malformed stats report", () => {
    expect(globalVoiceWebRtcPlaybackLevel(null)).toBe(0);
    expect(globalVoiceWebRtcPlaybackLevel({})).toBe(0);
    expect(globalVoiceWebRtcPlaybackLevel(new Map())).toBe(0);
    expect(
      globalVoiceWebRtcPlaybackLevel(
        new Map([["assistant", { audioLevel: Number.NaN, kind: "audio", type: "inbound-rtp" }]]),
      ),
    ).toBe(0);
  });

  it("keeps content-free outbound audio counters separate from playback level", () => {
    const report = new Map([
      ["assistant", { audioLevel: 0.4, kind: "audio", type: "inbound-rtp" }],
      ["microphone-a", { bytesSent: 1_000, kind: "audio", packetsSent: 10, type: "outbound-rtp" }],
      [
        "microphone-b",
        { bytesSent: 500, mediaType: "audio", packetsSent: 5, type: "outbound-rtp" },
      ],
      ["video", { bytesSent: 9_999, kind: "video", packetsSent: 99, type: "outbound-rtp" }],
    ]);

    expect(globalVoiceWebRtcPlaybackLevel(report)).toBe(0.4);
    expect(globalVoiceWebRtcTransportSnapshot(report)).toEqual({
      outboundAudioBytes: 1_500,
      outboundAudioPackets: 15,
    });
  });
});
