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
import { globalVoiceWebRtcUserSpeaking } from "./globalVoiceWebRtcSpeechEvent";
import { acquireGlobalVoiceAudioRoute } from "./globalVoiceAudioRoute.native";
import type { GlobalVoiceAudioRouteLease } from "./globalVoiceAudioRouteContract";
import { observeGlobalVoiceNativePeer } from "./globalVoiceNativePeer.native";
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
  audioRoute: GlobalVoiceAudioRouteLease | null;
  audioSender: RTCRtpSender | null;
  captureHealthSubscription: NativeEventSubscription | null;
  readonly connected: PromiseWithResolvers<undefined>;
  readonly dataChannel: WebRtcDataChannel;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  lastOutboundAudioBytes: number;
  lastOutboundAudioPackets: number;
  localStream: MediaStream | null;
  readonly mediaDevices: typeof mediaDevices;
  microphoneAppliedVersion: number;
  microphoneIntentVersion: number;
  microphoneMuted: boolean;
  microphoneTransition: Promise<void>;
  onTerminal: () => void;
  readonly peer: RTCPeerConnection;
  personalVoiceFilter: PersonalVoiceFilterLease | null;
  readonly personalVoiceFilterEnabled: boolean;
  playbackLevelTimer: ReturnType<typeof setInterval> | null;
  requestedMicrophoneMuted: boolean;
  stopNativeObservation: (() => void) | null;
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
  const stopObservation = owner.stopNativeObservation;
  owner.stopNativeObservation = null;
  failures.capture(() => {
    stopObservation?.();
  });
  const captureHealthSubscription = owner.captureHealthSubscription;
  owner.captureHealthSubscription = null;
  failures.capture(() => {
    captureHealthSubscription?.remove();
  });
  if (owner.disconnectTimer !== null) {
    clearTimeout(owner.disconnectTimer);
    owner.disconnectTimer = null;
  }
  if (owner.playbackLevelTimer !== null) {
    clearInterval(owner.playbackLevelTimer);
    owner.playbackLevelTimer = null;
  }
  failures.capture(() => {
    owner.dataChannel.onmessage = null;
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
    stream.release();
  });
  failures.throwIfFailed();
}

function releaseLocalStream(owner: WebRtcOwner): void {
  const failures = new CleanupFailures();
  const filter = owner.personalVoiceFilter;
  owner.personalVoiceFilter = null;
  const stream = owner.localStream;
  owner.localStream = null;
  failures.capture(() => {
    filter?.stop();
  });
  if (stream !== null) {
    failures.capture(() => {
      releaseStream(stream);
    });
  }
  failures.throwIfFailed();
}

function disableLocalCapture(owner: WebRtcOwner): void {
  // Close the capture gate before waiting for any asynchronous sender operation.
  // Speaker matching must not reopen a track after an explicit mute intent.
  owner.personalVoiceFilter?.stop();
  owner.personalVoiceFilter = null;
  for (const track of owner.localStream?.getAudioTracks() ?? []) {
    track.enabled = false;
  }
}

function ignoreCleanupFailure(action: () => void): void {
  try {
    action();
  } catch {
    // Startup keeps its original failure authoritative after best-effort cleanup.
  }
}

async function cleanupFailedStartup(owner: WebRtcOwner | null): Promise<void> {
  if (owner === null) {
    return;
  }
  owner.stopped = true;
  ignoreCleanupFailure(() => {
    stopOwnedMedia(owner);
  });
  await owner.audioRoute?.release().catch(() => undefined);
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
  audioTrack.enabled = false;
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
          owner.stopping ||
          owner.requestedMicrophoneMuted ||
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

function microphoneSessionIsLive(owner: WebRtcOwner): boolean {
  return !owner.stopped && !owner.stopping;
}

function microphoneRequestIsCurrent(owner: WebRtcOwner, version: number): boolean {
  return microphoneSessionIsLive(owner) && version === owner.microphoneIntentVersion;
}

async function attachMicrophoneCapture(
  owner: WebRtcOwner,
  version: number,
  track: MediaStreamTrack,
): Promise<void> {
  await replaceAudioTrack(owner, track);
  if (microphoneRequestIsCurrent(owner, version)) {
    await owner.audioRoute?.setMuted(false);
  }
  if (!microphoneRequestIsCurrent(owner, version)) {
    await replaceAudioTrack(owner, null);
    releaseLocalStream(owner);
    return;
  }
  owner.microphoneMuted = false;
  owner.microphoneAppliedVersion = version;
  if (!owner.personalVoiceFilterEnabled) {
    track.enabled = true;
  }
}

async function resumeMicrophone(owner: WebRtcOwner, version: number): Promise<void> {
  // Off/on in one tick still closed the native gate. Reconcile even if the final boolean
  // equals the starting state; never infer applied media state from the last UI boolean.
  if (owner.localStream !== null) {
    await replaceAudioTrack(owner, null);
    releaseLocalStream(owner);
    owner.microphoneMuted = true;
  }
  if (!microphoneRequestIsCurrent(owner, version)) {
    return;
  }
  const capture = await captureMicrophone(owner);
  owner.localStream = capture.stream;
  try {
    if (!microphoneRequestIsCurrent(owner, version)) {
      releaseLocalStream(owner);
      return;
    }
    await attachMicrophoneCapture(owner, version, capture.track);
  } catch (error) {
    releaseLocalStream(owner);
    throw error;
  }
}

async function applyRequestedMicrophoneState(owner: WebRtcOwner): Promise<void> {
  while (
    microphoneSessionIsLive(owner) &&
    owner.microphoneAppliedVersion !== owner.microphoneIntentVersion
  ) {
    const version = owner.microphoneIntentVersion;
    if (owner.requestedMicrophoneMuted) {
      await replaceAudioTrack(owner, null);
      releaseLocalStream(owner);
      owner.microphoneMuted = true;
      owner.microphoneAppliedVersion = version;
    } else {
      await resumeMicrophone(owner, version);
    }
  }
}

function acceptsMediaEvents(owner: WebRtcOwner): boolean {
  return !owner.stopped && !owner.stopping && !owner.terminalPublished;
}

async function stopSession(owner: WebRtcOwner): Promise<void> {
  owner.stopping = true;
  owner.stopped = true;
  owner.connected.reject(new Error("Global Voice WebRTC session stopped"));
  const failures = new CleanupFailures();
  failures.capture(() => {
    disableLocalCapture(owner);
  });
  // Playback and existing capture end immediately, even if getUserMedia is still pending.
  failures.capture(() => {
    stopOwnedMedia(owner);
  });
  await owner.microphoneTransition.catch(() => undefined);
  await owner.audioRoute?.release();
  failures.throwIfFailed();
}

async function configureInteractiveAudio(options: ConfigureAudioOptions): Promise<void> {
  if (options.options.mode !== "interactive") {
    return;
  }
  options.owner.audioRoute = await acquireGlobalVoiceAudioRoute(options.options.initiallyMuted);
  options.owner.stopNativeObservation = await observeGlobalVoiceNativePeer(
    options.owner.peer._pcId,
  );
  if (options.options.initiallyMuted) {
    options.owner.audioSender = options.owner.peer.addTransceiver("audio", {
      direction: "sendrecv",
    }).sender;
  } else {
    const capture = await captureMicrophone(options.owner);
    options.owner.localStream = capture.stream;
    options.owner.audioSender = options.owner.peer.addTrack(capture.track, capture.stream);
    if (!options.owner.personalVoiceFilterEnabled) {
      capture.track.enabled = true;
    }
  }
  const publishPlaybackLevel = async (): Promise<void> => {
    if (options.owner.stopped || options.options.mode !== "interactive") {
      return;
    }
    try {
      const report: unknown = await options.owner.peer.getStats();
      if (!acceptsMediaEvents(options.owner)) {
        return;
      }
      options.options.onPlaybackLevel(globalVoiceWebRtcPlaybackLevel(report));
      const transport = globalVoiceWebRtcTransportSnapshot(report);
      options.owner.lastOutboundAudioBytes = transport.outboundAudioBytes;
      options.owner.lastOutboundAudioPackets = transport.outboundAudioPackets;
    } catch {
      if (acceptsMediaEvents(options.owner)) {
        options.options.onPlaybackLevel(0);
      }
      // Stats are visual-only and must not terminate an otherwise healthy media session.
    }
  };
  options.owner.dataChannel.onmessage = (event: { readonly data: unknown }) => {
    if (!acceptsMediaEvents(options.owner)) {
      return;
    }
    const speaking = globalVoiceWebRtcUserSpeaking(event.data);
    if (speaking !== null && options.options.mode === "interactive") {
      options.options.onUserSpeaking?.(speaking);
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
      if (owner.requestedMicrophoneMuted === muted) {
        await owner.microphoneTransition;
        return;
      }
      owner.requestedMicrophoneMuted = muted;
      owner.microphoneIntentVersion += 1;
      if (muted) {
        disableLocalCapture(owner);
      }
      const captureGate = muted ? owner.audioRoute?.setMuted(true) : Promise.resolve();
      const transition = Promise.all([
        owner.microphoneTransition.catch(() => undefined),
        captureGate,
      ]).then(async () => applyRequestedMicrophoneState(owner));
      owner.microphoneTransition = transition;
      await transition;
    },
    async stop() {
      owner.stopPromise ??= stopSession(owner);
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
      audioRoute: null,
      audioSender: null,
      captureHealthSubscription: null,
      connected: Promise.withResolvers<undefined>(),
      dataChannel: peer.createDataChannel("oai-events"),
      disconnectTimer: null,
      lastOutboundAudioBytes: 0,
      lastOutboundAudioPackets: 0,
      localStream: null,
      mediaDevices,
      microphoneAppliedVersion: 0,
      microphoneIntentVersion: 0,
      microphoneMuted: options.mode === "interactive" && options.initiallyMuted,
      microphoneTransition: Promise.resolve(),
      onTerminal: () => undefined,
      peer,
      personalVoiceFilter: null,
      personalVoiceFilterEnabled:
        options.mode === "interactive" && options.personalVoiceFilterEnabled === true,
      playbackLevelTimer: null,
      requestedMicrophoneMuted: options.mode === "interactive" && options.initiallyMuted,
      stopNativeObservation: null,
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
    await cleanupFailedStartup(owner);
    throw error;
  }
};
