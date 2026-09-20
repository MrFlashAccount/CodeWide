import { describe, expect, it } from "vitest";

import { globalVoiceWebRtcAudioLevel } from "../src/native/globalVoiceWebRtcAudioLevel";

describe("Global Voice WebRTC audio level", () => {
  it("selects the highest bounded microphone media-source level", () => {
    const report = new Map([
      ["codec", { audioLevel: 0.9, type: "codec" }],
      ["quiet-microphone", { audioLevel: 0.2, type: "media-source" }],
      ["active-microphone", { audioLevel: 1.4, type: "media-source" }],
    ]);

    expect(globalVoiceWebRtcAudioLevel(report)).toBe(1);
  });

  it("falls back to silence for an empty or malformed stats report", () => {
    expect(globalVoiceWebRtcAudioLevel(null)).toBe(0);
    expect(globalVoiceWebRtcAudioLevel({})).toBe(0);
    expect(globalVoiceWebRtcAudioLevel(new Map())).toBe(0);
    expect(
      globalVoiceWebRtcAudioLevel(
        new Map([["microphone", { audioLevel: Number.NaN, type: "media-source" }]]),
      ),
    ).toBe(0);
  });
});
