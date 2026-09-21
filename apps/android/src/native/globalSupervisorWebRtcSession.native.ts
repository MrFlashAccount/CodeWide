import type {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpSender,
} from "react-native-webrtc";
import { NativeEventEmitter, NativeModules } from "react-native";

import { globalSupervisorLimitsV1 } from "../data/globalSupervisorLimitsV1";
import { appLogger } from "../observability/logger";
import {
  globalVoiceWebRtcPlaybackLevel,
  globalVoiceWebRtcTransportSnapshot,
} from "./globalVoiceWebRtcAudioLevel";
import { startPersonalVoiceFilter } from "./personalVoiceFilter.native";
import type { PersonalVoiceFilterLease } from "./personalVoiceFilterContract";
import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "./globalSupervisorWebRtcSessionContract";

type WebRtcDataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>;
type GlobalSupervisorWebRtcSessionOptions = Parameters<GlobalSupervisorWebRtcSessionFactory>[0];
type NativeEventSubscription = { readonly remove: () => void };
type GlobalVoiceForegroundEventBridge = {
  readonly addListener: (eventName: string) => void;
  readonly removeListeners: (count: number) => void;
};
type WebRtcTerminalSource =
  | "captureInterrupted"
  | "connectionClosed"
  | "connectionFailed"
  | "disconnectedTimeout"
  | "trackEnded";

type WebRtcOwner = {
  answerAccepted: boolean;
  audioSender: RTCRtpSender | null;
  captureHealthSubscription: NativeEventSubscription | null;
  readonly connected: PromiseWithResolvers<undefined>;
  readonly dataChannel: WebRtcDataChannel;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  lastOutboundAudioBytes: number;
  lastOutboundAudioPackets: number;
  localStream: MediaStream | null;
  readonly mediaDevices: typeof mediaDevices;
  microphoneMuted: boolean;
  microphoneTransition: Promise<void>;
  onTerminal: () => void;
  readonly peer: RTCPeerConnection;
  personalVoiceFilter: PersonalVoiceFilterLease | null;
  readonly personalVoiceFilterEnabled: boolean;
  playbackLevelTimer: ReturnType<typeof setInterval> | null;
  requestedMicrophoneMuted: boolean;
  stopped: boolean;
  stopping: boolean;
  stopPromise: Promise<void> | null;
  terminalPublished: boolean;
};

type ConfigureAudioOptions = {
  readonly mediaDevices: typeof mediaDevices;
  readonly options: GlobalSupervisorWebRtcSessionOptions;
  readonly owner: WebRtcOwner;
};

const MAX_SDP_CHARACTERS = 262_144;
const AUDIO_LEVEL_POLL_INTERVAL_MS = 100;
const CAPTURE_INTERRUPTED_EVENT_NAME = "CodeWideGlobalVoiceCaptureInterrupted";
const DISCONNECTED_GRACE_MS = 3000;

async function waitForIceGatheringComplete(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") {
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.onicegatheringstatechange = null;
      reject(new Error("Global Voice WebRTC ICE gathering timed out"));
    }, globalSupervisorLimitsV1.realtimeStartupTimeoutMs);
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState !== "complete") {
        return;
      }
      peer.onicegatheringstatechange = null;
      clearTimeout(timer);
      resolve();
    };
  });
}

function validSdp(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SDP_CHARACTERS && value.startsWith("v=0");
}

class CleanupFailures {
  private failed = false;
  private failure: unknown;

  capture(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.record(error);
    }
  }

  throwIfFailed(): void {
    if (this.failed) {
      throw this.failure;
    }
  }

  private record(error: unknown): void {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
    }
  }
}

function stopOwnedMedia(owner: WebRtcOwner): void {
  const failures = new CleanupFailures();
  owner.captureHealthSubscription?.remove();
  owner.captureHealthSubscription = null;
  if (owner.disconnectTimer !== null) {
    clearTimeout(owner.disconnectTimer);
    owner.disconnectTimer = null;
  }
  if (owner.playbackLevelTimer !== null) {
    clearInterval(owner.playbackLevelTimer);
    owner.playbackLevelTimer = null;
  }
  failures.capture(() => {
    owner.dataChannel.close();
  });
  failures.capture(() => {
    releaseLocalStream(owner);
  });
  failures.capture(() => {
    owner.peer.close();
  });
  failures.throwIfFailed();
}

function releaseStream(stream: MediaStream): void {
  const failures = new CleanupFailures();
  for (const track of stream.getTracks()) {
    track.onended = null;
    failures.capture(() => {
      track.stop();
    });
  }
  failures.capture(() => {
    stream.release(false);
  });
  failures.throwIfFailed();
}

function releaseLocalStream(owner: WebRtcOwner): void {
  owner.personalVoiceFilter?.stop();
  owner.personalVoiceFilter = null;
  const stream = owner.localStream;
  owner.localStream = null;
  if (stream !== null) {
    releaseStream(stream);
  }
}

function ignoreCleanupFailure(action: () => void): void {
  try {
    action();
  } catch {
    // Startup keeps its original failure authoritative after best-effort cleanup.
  }
}

function cleanupFailedStartup(owner: WebRtcOwner | null): void {
  if (owner === null) {
    return;
  }
  owner.stopped = true;
  ignoreCleanupFailure(() => {
    stopOwnedMedia(owner);
  });
}

function publishTerminal(
  owner: WebRtcOwner,
  onTerminal: () => void,
  source: WebRtcTerminalSource,
): void {
  if (owner.stopped || owner.terminalPublished) {
    return;
  }
  if (owner.disconnectTimer !== null) {
    clearTimeout(owner.disconnectTimer);
    owner.disconnectTimer = null;
  }
  owner.terminalPublished = true;
  appLogger.warn({
    event: "global_voice.webrtc.terminal",
    fields: {
      connectionState: owner.peer.connectionState,
      outboundAudioBytes: owner.lastOutboundAudioBytes,
      outboundAudioPackets: owner.lastOutboundAudioPackets,
      source,
    },
  });
  owner.connected.reject(new Error("Global Voice WebRTC media connection terminated"));
  onTerminal();
}

function acceptConnectionChange(owner: WebRtcOwner, onTerminal: () => void): void {
  appLogger.info({
    event: "global_voice.webrtc.connection_state",
    fields: { state: owner.peer.connectionState },
  });
  switch (owner.peer.connectionState) {
    case "connected":
      if (owner.disconnectTimer !== null) {
        clearTimeout(owner.disconnectTimer);
        owner.disconnectTimer = null;
      }
      owner.connected.resolve(undefined);
      return;
    case "closed":
      publishTerminal(owner, onTerminal, "connectionClosed");
      return;
    case "failed":
      publishTerminal(owner, onTerminal, "connectionFailed");
      return;
    case "disconnected":
      owner.disconnectTimer ??= setTimeout(() => {
        owner.disconnectTimer = null;
        publishTerminal(owner, onTerminal, "disconnectedTimeout");
      }, DISCONNECTED_GRACE_MS);
      return;
    case "connecting":
    case "new":
      return;
  }
}

function bindCaptureHealth(owner: WebRtcOwner, onTerminal: () => void): NativeEventSubscription {
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceForeground;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Global Voice foreground health bridge is unavailable");
  }
  // WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bridge = candidate as GlobalVoiceForegroundEventBridge;
  const emitter = new NativeEventEmitter(bridge);
  return emitter.addListener(CAPTURE_INTERRUPTED_EVENT_NAME, () => {
    publishTerminal(owner, onTerminal, "captureInterrupted");
  });
}

async function captureMicrophone(owner: WebRtcOwner): Promise<{
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
}> {
  const stream = await owner.mediaDevices.getUserMedia({ audio: true, video: false });
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length !== 1) {
    releaseStream(stream);
    throw new Error("Global Voice WebRTC requires exactly one microphone track");
  }
  const audioTrack = audioTracks[0];
  if (audioTrack === undefined) {
    releaseStream(stream);
    throw new Error("Global Voice WebRTC microphone track is unavailable");
  }
  audioTrack.onended = owner.onTerminal;
  try {
    if (owner.personalVoiceFilterEnabled) {
      audioTrack.enabled = false;
      const filter = await startPersonalVoiceFilter((decision) => {
        appLogger.info({
          event: "global_voice.personal_voice_filter.decision",
          fields: { open: decision.open, similarity: decision.similarity },
        });
        if (
          owner.stopped ||
          owner.microphoneMuted ||
          owner.localStream?.getAudioTracks()[0] !== audioTrack
        ) {
          return;
        }
        audioTrack.enabled = decision.open;
      });
      if (filter === null) {
        appLogger.warn({ event: "global_voice.personal_voice_filter.unavailable" });
      } else {
        // A disabled WebRTC track still keeps AudioRecord running, so native speaker matching can
        // reopen this same track without sending unmatched microphone frames.
        owner.personalVoiceFilter = filter;
      }
    }
  } catch (error) {
    releaseStream(stream);
    throw error;
  }
  return { stream, track: audioTrack };
}

async function replaceAudioTrack(
  owner: WebRtcOwner,
  track: MediaStreamTrack | null,
): Promise<void> {
  const sender = owner.audioSender;
  if (sender === null) {
    throw new Error("Global Voice WebRTC audio sender is unavailable");
  }
  await sender.replaceTrack(track);
  if (sender.track !== track) {
    throw new Error("Global Voice WebRTC could not replace the microphone track");
  }
}

async function applyRequestedMicrophoneState(owner: WebRtcOwner): Promise<void> {
  while (!owner.stopped && owner.microphoneMuted !== owner.requestedMicrophoneMuted) {
    if (owner.requestedMicrophoneMuted) {
      await replaceAudioTrack(owner, null);
      releaseLocalStream(owner);
      owner.microphoneMuted = true;
      continue;
    }
    const capture = await captureMicrophone(owner);
    try {
      await replaceAudioTrack(owner, capture.track);
      owner.localStream = capture.stream;
      owner.microphoneMuted = false;
    } catch (error) {
      owner.personalVoiceFilter?.stop();
      owner.personalVoiceFilter = null;
      releaseStream(capture.stream);
      throw error;
    }
  }
}

async function configureInteractiveAudio(options: ConfigureAudioOptions): Promise<void> {
  if (options.options.mode !== "interactive") {
    return;
  }
  if (options.options.initiallyMuted) {
    options.owner.audioSender = options.owner.peer.addTransceiver("audio", {
      direction: "sendrecv",
    }).sender;
  } else {
    const capture = await captureMicrophone(options.owner);
    options.owner.localStream = capture.stream;
    options.owner.audioSender = options.owner.peer.addTrack(capture.track, capture.stream);
  }
  const publishPlaybackLevel = async (): Promise<void> => {
    if (options.owner.stopped || options.options.mode !== "interactive") {
      return;
    }
    try {
      const report: unknown = await options.owner.peer.getStats();
      options.options.onPlaybackLevel(globalVoiceWebRtcPlaybackLevel(report));
      const transport = globalVoiceWebRtcTransportSnapshot(report);
      options.owner.lastOutboundAudioBytes = transport.outboundAudioBytes;
      options.owner.lastOutboundAudioPackets = transport.outboundAudioPackets;
    } catch {
      // Stats are visual-only and must not terminate an otherwise healthy media session.
    }
  };
  publishPlaybackLevel().catch(() => undefined);
  options.owner.captureHealthSubscription = bindCaptureHealth(
    options.owner,
    options.options.onTerminal,
  );
  options.owner.playbackLevelTimer = setInterval(() => {
    publishPlaybackLevel().catch(() => undefined);
  }, AUDIO_LEVEL_POLL_INTERVAL_MS);
}

async function configureAudio(options: ConfigureAudioOptions): Promise<void> {
  if (options.options.mode === "interactive") {
    await configureInteractiveAudio(options);
    return;
  }
  options.owner.peer.addTransceiver("audio", { direction: "recvonly" });
}

function createPublicSession(owner: WebRtcOwner, offerSdp: string): GlobalSupervisorWebRtcSession {
  return {
    async acceptAnswer(sdp) {
      if (owner.stopped || owner.stopping) {
        throw new Error("Global Voice WebRTC session is stopped");
      }
      if (owner.answerAccepted || !validSdp(sdp)) {
        throw new Error("Global Voice WebRTC received an invalid SDP answer");
      }
      owner.answerAccepted = true;
      await owner.peer.setRemoteDescription({ sdp, type: "answer" });
      if (owner.peer.connectionState === "connected") {
        owner.connected.resolve(undefined);
      }
      await owner.connected.promise;
    },
    offerSdp,
    async setMicrophoneMuted(muted) {
      if (owner.stopped || owner.stopping) {
        throw new Error("Global Voice WebRTC session is stopped");
      }
      owner.requestedMicrophoneMuted = muted;
      const transition = owner.microphoneTransition
        .catch(() => undefined)
        .then(async () => applyRequestedMicrophoneState(owner));
      owner.microphoneTransition = transition;
      await transition;
    },
    async stop() {
      owner.stopping = true;
      owner.stopPromise ??= owner.microphoneTransition
        .catch(() => undefined)
        .then(() => {
          owner.stopped = true;
          owner.connected.reject(new Error("Global Voice WebRTC session stopped"));
          stopOwnedMedia(owner);
        });
      await owner.stopPromise;
      await owner.connected.promise.catch(() => undefined);
    },
  };
}

/** Owns Android microphone capture and remote GPT Live playback through one WebRTC peer. */
export const createGlobalSupervisorWebRtcSession: GlobalSupervisorWebRtcSessionFactory = async (
  options,
) => {
  let owner: WebRtcOwner | null = null;

  try {
    const { mediaDevices, RTCPeerConnection } = await import("react-native-webrtc");
    const peer = new RTCPeerConnection();
    const activeOwner: WebRtcOwner = {
      answerAccepted: false,
      audioSender: null,
      captureHealthSubscription: null,
      connected: Promise.withResolvers<undefined>(),
      dataChannel: peer.createDataChannel("oai-events"),
      disconnectTimer: null,
      lastOutboundAudioBytes: 0,
      lastOutboundAudioPackets: 0,
      localStream: null,
      mediaDevices,
      microphoneMuted: options.mode === "interactive" && options.initiallyMuted,
      microphoneTransition: Promise.resolve(),
      onTerminal: () => undefined,
      peer,
      personalVoiceFilter: null,
      personalVoiceFilterEnabled:
        options.mode === "interactive" && options.personalVoiceFilterEnabled === true,
      playbackLevelTimer: null,
      requestedMicrophoneMuted: options.mode === "interactive" && options.initiallyMuted,
      stopped: false,
      stopping: false,
      stopPromise: null,
      terminalPublished: false,
    };
    owner = activeOwner;
    void activeOwner.connected.promise.catch(() => undefined);
    const onTerminal = (): void => {
      publishTerminal(activeOwner, options.onTerminal, "trackEnded");
    };
    activeOwner.onTerminal = onTerminal;
    peer.onconnectionstatechange = () => {
      acceptConnectionChange(activeOwner, options.onTerminal);
    };
    await configureAudio({ mediaDevices, options, owner: activeOwner });
    await peer.setLocalDescription();
    await waitForIceGatheringComplete(peer);
    const offerSdp = peer.localDescription?.sdp;
    if (offerSdp === undefined || !validSdp(offerSdp)) {
      throw new Error("Global Voice WebRTC produced an invalid SDP offer");
    }
    return createPublicSession(activeOwner, offerSdp);
  } catch (error) {
    cleanupFailedStartup(owner);
    throw error;
  }
};
