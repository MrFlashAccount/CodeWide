import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const platform = vi.hoisted(() => {
  const operationOrder: string[] = [];
  let captureMuted = false;
  const nativeListeners = new Map<string, Set<(value?: unknown) => void>>();
  const audioRouting = {
    forcedCommunicationRoute: null as "speaker" | null,
    systemMediaRoute: "speaker" as "a2dp" | "speaker",
    output(): "a2dp" | "speaker" {
      return this.forcedCommunicationRoute ?? this.systemMediaRoute;
    },
    reset(): void {
      this.forcedCommunicationRoute = null;
      this.systemMediaRoute = "speaker";
    },
    selectSystemMediaRoute(route: "a2dp" | "speaker"): void {
      this.systemMediaRoute = route;
    },
  };
  class PeerConnection {
    constructor() {
      operationOrder.push("peer.open");
    }

    _pcId = 17;
    connectionState = "new";
    iceGatheringState = "new";
    localDescription: { sdp: string; type: string } | null = null;
    onconnectionstatechange: (() => void) | null = null;
    onicegatheringstatechange: (() => void) | null = null;

    addTrack = vi.fn((track: unknown) => {
      const sender = senderFor(track);
      this.senders.push(sender);
      return sender;
    });
    addTransceiver = vi.fn(() => {
      const sender = senderFor(null);
      this.senders.push(sender);
      return { sender };
    });
    close = vi.fn();
    channel = { close: vi.fn(), onmessage: null as ((event: { readonly data: unknown }) => void) | null };
    createDataChannel = vi.fn(() => this.channel);
    getStats = vi.fn(
      async () =>
        new Map([
          ["microphone", { audioLevel: 0.42, kind: "audio", type: "media-source" }],
          ["assistant", { audioLevel: 0.73, kind: "audio", type: "inbound-rtp" }],
          [
            "microphone-rtp",
            { bytesSent: 8_192, kind: "audio", packetsSent: 64, type: "outbound-rtp" },
          ],
        ]),
    );
    setLocalDescription = vi.fn(async () => {
      this.iceGatheringState = "gathering";
      this.localDescription = { sdp: "v=0\r\nwithout-candidates", type: "offer" };
    });
    setRemoteDescription = vi.fn(async () => undefined);
    senders: ReturnType<typeof senderFor>[] = [];
    receivedFrames: number[] = [];

    completeIce(): void {
      this.localDescription = { sdp: "v=0\r\nwith-complete-candidates", type: "offer" };
      this.iceGatheringState = "complete";
      this.onicegatheringstatechange?.();
    }

    transitionConnection(state: string): void {
      this.connectionState = state;
      this.onconnectionstatechange?.();
    }
  }

  const peerConnections: PeerConnection[] = [];
  const streams: ReturnType<typeof captureStream>[] = [];
  function senderFor(initialTrack: unknown) {
    return {
      replaceTrack: vi.fn(async function (this: { track: unknown }, track: unknown) {
        this.track = track;
      }),
      track: initialTrack,
    };
  }
  function captureStream() {
    const track = { enabled: true, onended: null as (() => void) | null, stop: vi.fn(() => { track.enabled = false; }) };
    return {
      emitFrame(frame: number): void {
        if (!track.enabled || captureMuted) return;
        for (const peer of peerConnections) {
          if (peer.senders.some((sender) => sender.track === track)) peer.receivedFrames.push(frame);
        }
      },
      getAudioTracks: vi.fn(() => [track]),
      getTracks: vi.fn(() => [track]),
      release: vi.fn(),
      track,
    };
  }
  const foregroundBridge = {
    acquire: vi.fn(async () => "foreground-token"),
    observeWebRtc: vi.fn(async () => undefined),
    stopObservingWebRtc: vi.fn(),
    canDrawOverlays: vi.fn(async () => true),
    clearOrbLaunchOrigin: vi.fn(),
    openOverlaySettings: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    setPlaybackLevel: vi.fn(),
    setOrbLaunchOrigin: vi.fn(),
  };
  const communicationAudioBridge = {
    acquire: vi.fn(async () => {
      operationOrder.push("mode.acquire");
      audioRouting.forcedCommunicationRoute = "speaker";
      return "communication-audio-token";
    }),
    release: vi.fn(async () => {
      audioRouting.forcedCommunicationRoute = null;
      return true;
    }),
  };
  const personalVoiceFilterBridge = {
    hasProfile: true,
    startEnrollment: vi.fn(async () => ({ hasProfile: true })),
    startFiltering: vi.fn(async () => ({ active: true })),
    stopFiltering: vi.fn(),
  };
  return {
    audioRouting,
    captureStream,
    audioRouteBridge: {
      acquire: vi.fn(async (muted: boolean) => { captureMuted = muted; return "route-lease"; }),
      release: vi.fn(async () => { captureMuted = false; }),
      setMuted: vi.fn(async (_token: string, muted: boolean) => { captureMuted = muted; }),
    },
    communicationAudioBridge,
    emitNative(eventName: string, value?: unknown): void {
      for (const listener of nativeListeners.get(eventName) ?? []) listener(value);
    },
    foregroundBridge,
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = captureStream();
        streams.push(stream);
        return stream;
      }),
    },
    operationOrder,
    personalVoiceFilterBridge,
    nativeListeners,
    PeerConnection,
    peerConnections,
    streams,
  };
});

// WHY: React Native's native module registry is unavailable in the Node test runtime.
// The overlay-permission adapter is exercised against only that external registry replacement.
vi.mock("react-native", () => ({
  NativeEventEmitter: class {
    addListener(eventName: string, listener: (value?: unknown) => void) {
      const listeners =
        platform.nativeListeners.get(eventName) ?? new Set<(value?: unknown) => void>();
      listeners.add(listener);
      platform.nativeListeners.set(eventName, listeners);
      return { remove: () => listeners.delete(listener) };
    }
  },
  NativeModules: {
    CodeWideGlobalVoiceAudioRoute: platform.audioRouteBridge,
    CodeWideGlobalVoiceCommunicationAudio: platform.communicationAudioBridge,
    CodeWideGlobalVoiceForeground: platform.foregroundBridge,
    CodeWidePersonalVoiceFilter: platform.personalVoiceFilterBridge,
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
  platform.audioRouting.reset();
  platform.nativeListeners.clear();
  platform.peerConnections.splice(0);
  platform.streams.splice(0);
  platform.operationOrder.splice(0);
  platform.personalVoiceFilterBridge.hasProfile = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Global Voice native WebRTC offer", () => {
  it("forwards only live VAD edges and fences pending stats after stop", async () => {
    const onUserSpeaking = vi.fn();
    const onPlaybackLevel = vi.fn();
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel,
      onTerminal: vi.fn(),
      onUserSpeaking,
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected WebRTC peer");
    peer.completeIce();
    const session = await creation;
    expect(platform.foregroundBridge.observeWebRtc).toHaveBeenCalledWith(peer._pcId);
    const receive = peer.channel.onmessage;
    receive?.({ data: '{"type":"input_audio_buffer.speech_started"}' });
    receive?.({ data: '{"type":"response.done"}' });
    receive?.({ data: '{"type":"input_audio_buffer.speech_stopped"}' });
    expect(onUserSpeaking.mock.calls).toEqual([[true], [false]]);
    expect(onPlaybackLevel).toHaveBeenCalledWith(0.73);
    const pending = Promise.withResolvers<Map<string, { audioLevel: number; kind: string; type: string }>>();
    peer.getStats.mockImplementationOnce(() => pending.promise);
    await vi.waitFor(() => expect(peer.getStats).toHaveBeenCalledTimes(2));
    await session.stop();
    expect(platform.foregroundBridge.stopObservingWebRtc).toHaveBeenCalledExactlyOnceWith(peer._pcId);
    const callsAtStop = onPlaybackLevel.mock.calls.length;
    pending.resolve(new Map([["assistant", { audioLevel: 1, kind: "audio", type: "inbound-rtp" }]]));
    await Promise.resolve();
    receive?.({ data: '{"type":"input_audio_buffer.speech_started"}' });
    expect(peer.channel.onmessage).toBeNull();
    expect(onUserSpeaking.mock.calls).toEqual([[true], [false]]);
    expect(onPlaybackLevel).toHaveBeenCalledTimes(callsAtStop);
  });

  it("keeps capture alive while the personal voice decision gates the outbound track", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
      personalVoiceFilterEnabled: true,
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer to be created");
    peer.completeIce();
    const session = await creation;
    const stream = platform.streams[0];
    if (stream === undefined) throw new Error("Expected microphone capture");

    expect(stream.track.enabled).toBe(false);
    expect(stream.track.stop).not.toHaveBeenCalled();
    platform.emitNative("CodeWidePersonalVoiceFilterDecision", { open: true, similarity: 0.94 });
    expect(stream.track.enabled).toBe(true);
    platform.emitNative("CodeWidePersonalVoiceFilterDecision", { open: false, similarity: 0.42 });
    expect(stream.track.enabled).toBe(false);

    await session.stop();
    expect(platform.personalVoiceFilterBridge.stopFiltering).toHaveBeenCalledOnce();
  });

  it("removes microphone frames without ending the session and restores capture on the same sender", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer to be created");
    peer.completeIce();
    const session = await creation;
    const sender = peer.senders[0];
    const firstCapture = platform.streams[0];
    if (sender === undefined || firstCapture === undefined) {
      throw new Error("Expected one microphone sender and capture");
    }

    firstCapture.emitFrame(1);
    expect(peer.receivedFrames).toEqual([1]);
    const mute = session.setMicrophoneMuted(true);
    firstCapture.emitFrame(2);
    expect(peer.receivedFrames).toEqual([1]);
    await mute;
    firstCapture.emitFrame(3);
    expect(peer.receivedFrames).toEqual([1]);

    expect(sender.replaceTrack).toHaveBeenCalledWith(null);
    expect(sender.track).toBeNull();
    expect(firstCapture.track.stop).toHaveBeenCalledOnce();
    expect(firstCapture.release).toHaveBeenCalledOnce();
    expect(peer.close).not.toHaveBeenCalled();
    expect(peer.setLocalDescription).toHaveBeenCalledOnce();

    await session.setMicrophoneMuted(false);

    const resumedCapture = platform.streams[1];
    if (resumedCapture === undefined) throw new Error("Expected microphone capture to resume");
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(resumedCapture.track);
    expect(sender.track).toBe(resumedCapture.track);
    resumedCapture.emitFrame(4);
    expect(peer.receivedFrames).toEqual([1, 4]);
    expect(platform.peerConnections).toHaveLength(1);
    expect(peer.setLocalDescription).toHaveBeenCalledOnce();
    await session.stop();
  });

  it("unmutes after a same-tick off/on pair instead of leaving the native gate closed", async () => {
    const creation = createGlobalSupervisorWebRtcSession({ initiallyMuted: false, mode: "interactive", onPlaybackLevel: vi.fn(), onTerminal: vi.fn() });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected peer");
    peer.completeIce();
    const session = await creation;
    await Promise.all([session.setMicrophoneMuted(true), session.setMicrophoneMuted(false)]);
    const capture = platform.streams.at(-1);
    capture?.emitFrame(7);
    expect(peer.receivedFrames).toEqual([7]);
    const acquired = platform.mediaDevices.getUserMedia.mock.calls.length;
    await session.setMicrophoneMuted(false);
    expect(platform.mediaDevices.getUserMedia).toHaveBeenCalledTimes(acquired);
    await session.stop();
  });

  it("fences capture acquired after a newer mute and ignores duplicate mute requests", async () => {
    const creation = createGlobalSupervisorWebRtcSession({ initiallyMuted: true, mode: "interactive", onPlaybackLevel: vi.fn(), onTerminal: vi.fn() });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected peer");
    peer.completeIce();
    const session = await creation;
    const capture = platform.captureStream();
    const pending = Promise.withResolvers<typeof capture>();
    platform.mediaDevices.getUserMedia.mockImplementationOnce(() => pending.promise);
    const opening = session.setMicrophoneMuted(false);
    await vi.waitFor(() => expect(platform.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    const closing = session.setMicrophoneMuted(true);
    const duplicate = session.setMicrophoneMuted(true);
    pending.resolve(capture);
    await Promise.all([opening, closing, duplicate]);
    capture.emitFrame(1);
    expect(peer.receivedFrames).toEqual([]);
    expect(peer.senders[0]?.track).toBeNull();
    expect(capture.track.stop).toHaveBeenCalledOnce();
    expect(capture.release).toHaveBeenCalledOnce();
    expect(platform.audioRouteBridge.setMuted).not.toHaveBeenCalledWith("route-lease", false);
    await session.setMicrophoneMuted(false);
    platform.streams.at(-1)?.emitFrame(2);
    expect(peer.receivedFrames).toEqual([2]);
    await session.stop();
    await session.stop();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.channel.close).toHaveBeenCalledOnce();
    expect(platform.audioRouteBridge.release).toHaveBeenCalledOnce();
  });

  it("Stop closes playback immediately and releases a late capture without attaching it", async () => {
    const creation = createGlobalSupervisorWebRtcSession({ initiallyMuted: true, mode: "interactive", onPlaybackLevel: vi.fn(), onTerminal: vi.fn() });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected peer");
    peer.completeIce();
    const session = await creation;
    const capture = platform.captureStream();
    const pending = Promise.withResolvers<typeof capture>();
    platform.mediaDevices.getUserMedia.mockImplementationOnce(() => pending.promise);
    const opening = session.setMicrophoneMuted(false);
    await vi.waitFor(() => expect(platform.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    const stopping = session.stop();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.channel.close).toHaveBeenCalledOnce();
    pending.resolve(capture);
    await Promise.all([opening, stopping, session.stop()]);
    capture.emitFrame(1);
    expect(peer.receivedFrames).toEqual([]);
    expect(peer.senders[0]?.track).toBeNull();
    expect(capture.track.stop).toHaveBeenCalledOnce();
    expect(capture.release).toHaveBeenCalledOnce();
    expect(platform.audioRouteBridge.release).toHaveBeenCalledOnce();
  });

  it("keeps capture closed while native detach is pending and after detach rejects", async () => {
    const creation = createGlobalSupervisorWebRtcSession({ initiallyMuted: false, mode: "interactive", onPlaybackLevel: vi.fn(), onTerminal: vi.fn() });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected peer");
    peer.completeIce();
    const session = await creation;
    const sender = peer.senders[0];
    const capture = platform.streams[0];
    if (sender === undefined || capture === undefined) throw new Error("Expected sender and capture");
    capture.emitFrame(1);
    const detach = Promise.withResolvers<void>();
    sender.replaceTrack.mockImplementationOnce(() => detach.promise);
    const mute = session.setMicrophoneMuted(true);
    const rejected = expect(mute).rejects.toThrow("native detach failed");
    capture.emitFrame(2);
    await vi.waitFor(() => expect(sender.replaceTrack).toHaveBeenCalledWith(null));
    capture.emitFrame(3);
    detach.reject(new Error("native detach failed"));
    await rejected;
    capture.emitFrame(4);
    expect(peer.receivedFrames).toEqual([1]);
    expect(peer.close).not.toHaveBeenCalled();
    await session.stop();
    expect(platform.audioRouteBridge.release).toHaveBeenCalledOnce();
  });

  it("starts a replacement transport muted without opening microphone capture", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: true,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer to be created");
    peer.completeIce();
    const session = await creation;

    expect(platform.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(peer.addTransceiver).toHaveBeenCalledWith("audio", { direction: "sendrecv" });
    expect(peer.senders[0]?.track).toBeNull();

    await session.stop();
  });

  it("publishes the SDP only after ICE gathering includes the final candidates", async () => {
    const onPlaybackLevel = vi.fn();
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel,
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
    expect(platform.operationOrder).toEqual(["peer.open"]);
    expect(peer.onicegatheringstatechange).toBeNull();
    await session.stop();
    await session.stop();
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
    expect(peer.getStats).toHaveBeenCalledWith();
    expect(onPlaybackLevel).toHaveBeenCalledWith(0.73);
  });

  it("preserves media headphones selected before interactive voice starts and stops", async () => {
    platform.audioRouting.selectSystemMediaRoute("a2dp");
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) {
      throw new Error("Expected the WebRTC peer to be created");
    }
    peer.completeIce();

    const session = await creation;

    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    await session.stop();
    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
  });

  it("allows media headphones connected after interactive voice starts to become output", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) {
      throw new Error("Expected the WebRTC peer to be created");
    }
    peer.completeIce();
    const session = await creation;

    platform.audioRouting.selectSystemMediaRoute("a2dp");

    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    await session.stop();
    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
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

    expect(platform.foregroundBridge.observeWebRtc).not.toHaveBeenCalled();
    expect(platform.foregroundBridge.acquire).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    expect(platform.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await session.stop();
    expect(platform.foregroundBridge.release).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
  });

  it("does not take over the media route when microphone startup fails", async () => {
    platform.audioRouting.selectSystemMediaRoute("a2dp");
    platform.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error("microphone failed"));

    await expect(
      createGlobalSupervisorWebRtcSession({
        initiallyMuted: false,
        mode: "interactive",
        onPlaybackLevel: vi.fn(),
        onTerminal: vi.fn(),
      }),
    ).rejects.toThrow("microphone failed");
    expect(platform.foregroundBridge.stopObservingWebRtc).toHaveBeenCalledWith(17);

    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
  });

  it("still releases media and the input route when observation teardown fails", async () => {
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer");
    peer.completeIce();
    const session = await creation;
    platform.foregroundBridge.stopObservingWebRtc.mockImplementationOnce(() => {
      throw new Error("Observation cleanup failed");
    });
    await expect(session.stop()).rejects.toThrow("Observation cleanup failed");
    await expect(session.stop()).rejects.toThrow("Observation cleanup failed");
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.channel.close).toHaveBeenCalledOnce();
    expect(platform.streams[0]?.release).toHaveBeenCalledOnce();
    expect(platform.audioRouteBridge.release).toHaveBeenCalledOnce();
  });

  it("does not mutate the media route when native media teardown throws", async () => {
    platform.audioRouting.selectSystemMediaRoute("a2dp");
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
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

    expect(platform.audioRouting.output()).toBe("a2dp");
    expect(platform.communicationAudioBridge.acquire).not.toHaveBeenCalled();
    expect(platform.communicationAudioBridge.release).not.toHaveBeenCalled();
  });

  it("reconnects only after a sustained disconnected state and cancels the grace on recovery", async () => {
    vi.useFakeTimers();
    const onTerminal = vi.fn();
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal,
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer to be created");
    peer.completeIce();
    const session = await creation;

    peer.transitionConnection("disconnected");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(onTerminal).not.toHaveBeenCalled();
    peer.transitionConnection("connected");
    await vi.advanceTimersByTimeAsync(1);
    expect(onTerminal).not.toHaveBeenCalled();

    peer.transitionConnection("disconnected");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onTerminal).toHaveBeenCalledOnce();
    await session.stop();
  });

  it("turns a native background capture interruption into one terminal media signal", async () => {
    const onTerminal = vi.fn();
    const creation = createGlobalSupervisorWebRtcSession({
      initiallyMuted: false,
      mode: "interactive",
      onPlaybackLevel: vi.fn(),
      onTerminal,
    });
    await vi.waitFor(() => expect(platform.peerConnections).toHaveLength(1));
    const peer = platform.peerConnections[0];
    if (peer === undefined) throw new Error("Expected the WebRTC peer to be created");
    peer.completeIce();
    const session = await creation;

    platform.emitNative("CodeWideGlobalVoiceCaptureInterrupted");
    platform.emitNative("CodeWideGlobalVoiceCaptureInterrupted");

    expect(onTerminal).toHaveBeenCalledOnce();
    await session.stop();
    expect(platform.nativeListeners.get("CodeWideGlobalVoiceCaptureInterrupted")?.size).toBe(0);
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
