import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ senderReplaceTrack: vi.fn() }));

// Only the external native bridge is replaced. Exercise the installed sender implementation,
// so a dependency update cannot silently restore its former swallowed-rejection behavior.
vi.mock("react-native", () => ({ NativeModules: { WebRTCModule: bridge } }));

import RTCRtpSender from "react-native-webrtc/src/RTCRtpSender";

function sender(): RTCRtpSender {
  return new RTCRtpSender({
    id: "audio-sender",
    peerConnectionId: 1,
    rtpParameters: {
      codecs: [],
      encodings: [],
      headerExtensions: [],
      rtcp: { cname: "test", reducedSize: true },
      transactionId: "test",
    },
  });
}

describe("installed WebRTC sender acknowledgement", () => {
  beforeEach(() => bridge.senderReplaceTrack.mockReset());

  it("rejects a native detach failure instead of acknowledging mute", async () => {
    const error = new Error("Native sender rejected replacement track");
    bridge.senderReplaceTrack.mockRejectedValueOnce(error);
    await expect(sender().replaceTrack(null)).rejects.toBe(error);
  });

  it("waits for native acknowledgement before resolving detach", async () => {
    const native = Promise.withResolvers<void>();
    bridge.senderReplaceTrack.mockReturnValueOnce(native.promise);
    let acknowledged = false;
    const pending = sender()
      .replaceTrack(null)
      .then(() => {
        acknowledged = true;
      });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(bridge.senderReplaceTrack).toHaveBeenCalledExactlyOnceWith(1, "audio-sender", null);
    native.resolve();
    await pending;
    expect(acknowledged).toBe(true);
  });
});
