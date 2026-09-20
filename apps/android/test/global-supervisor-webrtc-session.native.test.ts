import { beforeEach, describe, expect, it, vi } from "vitest";
const platform = vi.hoisted(() => {
  const operationOrder: string[] = [];
  class PeerConnection {
    constructor() {
      operationOrder.push("peer.open");
    }

    connectionState = "new";
    iceGatheringState = "new";
    localDescription: { sdp: string; type: string } | null = null;
    onconnectionstatechange: (() => void) | null = null;
    onicegatheringstatechange: (() => void) | null = null;

    addTrack = vi.fn();
    addTransceiver = vi.fn();
    close = vi.fn();
    createDataChannel = vi.fn(() => ({ close: vi.fn() }));
    getStats = vi.fn(
      async () => new Map([["microphone", { audioLevel: 0.42, type: "media-source" }]]),
    );
    setLocalDescription = vi.fn(async () => {
      this.iceGatheringState = "gathering";
      this.localDescription = { sdp: "v=0\r\nwithout-candidates", type: "offer" };
    });
    setRemoteDescription = vi.fn(async () => undefined);

    completeIce(): void {
      this.localDescription = { sdp: "v=0\r\nwith-complete-candidates", type: "offer" };
      this.iceGatheringState = "complete";
      this.onicegatheringstatechange?.();
    }
  }

  const peerConnections: PeerConnection[] = [];
  const stream = {
    getAudioTracks: vi.fn(() => [{ onended: null }]),
    getTracks: vi.fn(() => []),
    release: vi.fn(),
  };
  const foregroundBridge = {
    acquire: vi.fn(async () => "foreground-token"),
    canDrawOverlays: vi.fn(async () => true),
    clearOrbLaunchOrigin: vi.fn(),
    openOverlaySettings: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    setLevel: vi.fn(),
    setOrbLaunchOrigin: vi.fn(),
  };
  const communicationAudioBridge = {
    acquire: vi.fn(async () => {
      operationOrder.push("mode.acquire");
      return "communication-audio-token";
    }),
    release: vi.fn(async () => true),
  };
  return {
    communicationAudioBridge,
    foregroundBridge,
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    operationOrder,
    PeerConnection,
    peerConnections,
    stream,
  };
});

// WHY: React Native's native module registry is unavailable in the Node test runtime.
// The overlay-permission adapter is exercised against only that external registry replacement.
vi.mock("react-native", () => ({
  NativeModules: {
    CodeWideGlobalVoiceCommunicationAudio: platform.communicationAudioBridge,
    CodeWideGlobalVoiceForeground: platform.foregroundBridge,
  },
}));

// WHY: react-native-webrtc requires Android's native WebRTC runtime, which Node cannot host.
// The real Global Voice adapter runs while only that external platform boundary is replaced.
vi.mock("react-native-webrtc", () => ({
  mediaDevices: platform.mediaDevices,
  RTCPeerConnection: class extends platform.PeerConnection {
    constructor() {
      super();
      platform.peerConnections.push(this);
    }
  },
}));

import { createGlobalSupervisorWebRtcSession } from "../src/native/globalSupervisorWebRtcSession.native";
import {
  clearGlobalVoiceOrbLaunchOrigin,
  ensureGlobalVoiceOverlayPermission,
  stageGlobalVoiceOrbLaunchOrigin,
} from "../src/native/globalVoiceOverlayPermission.native";

beforeEach(() => {
  vi.clearAllMocks();
  platform.peerConnections.splice(0);
  platform.operationOrder.splice(0);
});

describe("Global Voice native WebRTC offer", () => {
  it("publishes the SDP only after ICE gathering includes the final candidates", async () => {
    const onLevel = vi.fn();
    const creation = createGlobalSupervisorWebRtcSession({
      mode: "interactive",
      onLevel,
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    expect(peer).toBeDefined();
    if (peer === undefined) {
      throw new Error("Expected the WebRTC peer to be created");
    }

    let settled = false;
    void creation.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    peer.completeIce();
    const session = await creation;
    expect(session.offerSdp).toBe("v=0\r\nwith-complete-candidates");
    expect(platform.operationOrder.slice(0, 2)).toEqual(["mode.acquire", "peer.open"]);
    expect(peer.onicegatheringstatechange).toBeNull();
    await session.stop();
    await session.stop();
    expect(platform.communicationAudioBridge.release).toHaveBeenCalledOnce();
    expect(platform.communicationAudioBridge.release).toHaveBeenCalledWith(
      "communication-audio-token",
    );
    expect(peer.getStats).toHaveBeenCalled();
    expect(onLevel).toHaveBeenCalledWith(0.42);
  });

  it("does not acquire communication audio ownership for receive-only voice previews", async () => {
    const creation = createGlobalSupervisorWebRtcSession({ mode: "preview", onTerminal: vi.fn() });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) {
      throw new Error("Expected the WebRTC peer to be created");
    }
    peer.completeIce();

    const session = await creation;

    expect(platform.foregroundBridge.acquire).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    expect(platform.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await session.stop();
    expect(platform.foregroundBridge.release).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
  });

  it("restores communication audio ownership when microphone startup fails", async () => {
    platform.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error("microphone failed"));

    await expect(
      createGlobalSupervisorWebRtcSession({
        mode: "interactive",
        onLevel: vi.fn(),
        onTerminal: vi.fn(),
      }),
    ).rejects.toThrow("microphone failed");

    expect(platform.communicationAudioBridge.acquire).toHaveBeenCalledOnce();
    expect(platform.communicationAudioBridge.release).toHaveBeenCalledOnce();
  });

  it("restores communication ownership when native media teardown throws", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      mode: "interactive",
      onLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) {
      throw new Error("Expected the WebRTC peer to be created");
    }
    peer.completeIce();
    const session = await creation;
    peer.close.mockImplementationOnce(() => {
      throw new Error("native close failed");
    });

    await expect(session.stop()).rejects.toThrow("native close failed");

    expect(platform.communicationAudioBridge.release).toHaveBeenCalledOnce();
  });
});

describe("Global Voice overlay permission", () => {
  it("opens the app-specific settings only while the overlay grant is missing", async () => {
    platform.foregroundBridge.canDrawOverlays.mockResolvedValueOnce(false);

    await expect(ensureGlobalVoiceOverlayPermission()).resolves.toBe("requested");
    expect(platform.foregroundBridge.openOverlaySettings).toHaveBeenCalledOnce();

    await expect(ensureGlobalVoiceOverlayPermission()).resolves.toBe("granted");
    expect(platform.foregroundBridge.openOverlaySettings).toHaveBeenCalledOnce();
  });

  it("stages the measured header geometry for the native overlay handoff", () => {
    stageGlobalVoiceOrbLaunchOrigin({ centerX: 31, centerY: 72, diameter: 34 });

    expect(platform.foregroundBridge.setOrbLaunchOrigin).toHaveBeenCalledWith(31, 72, 34);

    clearGlobalVoiceOrbLaunchOrigin();
    expect(platform.foregroundBridge.clearOrbLaunchOrigin).toHaveBeenCalledOnce();
  });
});
