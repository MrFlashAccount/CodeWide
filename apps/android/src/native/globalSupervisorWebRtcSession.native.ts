import type { mediaDevices, MediaStream, RTCPeerConnection } from "react-native-webrtc";

import { globalSupervisorLimitsV1 } from "../data/globalSupervisorLimitsV1";
import { acquireGlobalVoiceCommunicationAudio } from "./globalVoiceCommunicationAudio.native";
import type { GlobalVoiceCommunicationAudioLease } from "./globalVoiceCommunicationAudioContract";
import { globalVoiceWebRtcAudioLevel } from "./globalVoiceWebRtcAudioLevel";
import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "./globalSupervisorWebRtcSessionContract";

type WebRtcDataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>;
type GlobalSupervisorWebRtcSessionOptions = Parameters<GlobalSupervisorWebRtcSessionFactory>[0];

type WebRtcOwner = {
  answerAccepted: boolean;
  audioLevelTimer: ReturnType<typeof setInterval> | null;
  communicationAudio: GlobalVoiceCommunicationAudioLease | null;
  readonly connected: PromiseWithResolvers<undefined>;
  readonly dataChannel: WebRtcDataChannel;
  localStream: MediaStream | null;
  readonly peer: RTCPeerConnection;
  stopped: boolean;
  stopPromise: Promise<void> | null;
  terminalPublished: boolean;
};

type ConfigureAudioOptions = {
  readonly mediaDevices: typeof mediaDevices;
  readonly onTerminal: () => void;
  readonly options: GlobalSupervisorWebRtcSessionOptions;
  readonly owner: WebRtcOwner;
};

const MAX_SDP_CHARACTERS = 262_144;
const AUDIO_LEVEL_POLL_INTERVAL_MS = 100;

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

  async captureAsync(action: () => Promise<void>): Promise<void> {
    try {
      await action();
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

async function stopOwnedMedia(owner: WebRtcOwner): Promise<void> {
  const failures = new CleanupFailures();
  if (owner.audioLevelTimer !== null) {
    clearInterval(owner.audioLevelTimer);
    owner.audioLevelTimer = null;
  }
  failures.capture(() => {
    owner.dataChannel.close();
  });
  for (const track of owner.localStream?.getTracks() ?? []) {
    failures.capture(() => {
      track.stop();
    });
  }
  failures.capture(() => {
    owner.localStream?.release(false);
  });
  failures.capture(() => {
    owner.peer.close();
  });
  const communicationAudio = owner.communicationAudio;
  owner.communicationAudio = null;
  if (communicationAudio !== null) {
    await failures.captureAsync(async () => {
      await communicationAudio.release();
    });
  }
  failures.throwIfFailed();
}

async function ignoreCleanupFailure(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Startup keeps its original failure authoritative after best-effort cleanup.
  }
}

async function cleanupFailedStartup(
  owner: WebRtcOwner | null,
  communicationAudio: GlobalVoiceCommunicationAudioLease | null,
): Promise<void> {
  if (owner === null) {
    if (communicationAudio !== null) {
      await ignoreCleanupFailure(async () => {
        await communicationAudio.release();
      });
    }
    return;
  }
  owner.stopped = true;
  await ignoreCleanupFailure(async () => {
    await stopOwnedMedia(owner);
  });
}

function publishTerminal(owner: WebRtcOwner, onTerminal: () => void): void {
  if (owner.stopped || owner.terminalPublished) {
    return;
  }
  owner.terminalPublished = true;
  owner.connected.reject(new Error("Global Voice WebRTC media connection terminated"));
  onTerminal();
}

function acceptConnectionChange(owner: WebRtcOwner, onTerminal: () => void): void {
  switch (owner.peer.connectionState) {
    case "connected":
      owner.connected.resolve(undefined);
      return;
    case "closed":
    case "failed":
      publishTerminal(owner, onTerminal);
      return;
    case "connecting":
    case "disconnected":
    case "new":
      return;
  }
}

async function configureInteractiveAudio(options: ConfigureAudioOptions): Promise<void> {
  const stream = await options.mediaDevices.getUserMedia({ audio: true, video: false });
  options.owner.localStream = stream;
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length !== 1) {
    throw new Error("Global Voice WebRTC requires exactly one microphone track");
  }
  const audioTrack = audioTracks[0];
  if (audioTrack === undefined) {
    throw new Error("Global Voice WebRTC microphone track is unavailable");
  }
  audioTrack.onended = options.onTerminal;
  options.owner.peer.addTrack(audioTrack, stream);
  const publishAudioLevel = async (): Promise<void> => {
    if (options.owner.stopped || options.options.mode !== "interactive") {
      return;
    }
    try {
      options.options.onLevel(
        globalVoiceWebRtcAudioLevel(await options.owner.peer.getStats(audioTrack)),
      );
    } catch {
      // Stats are visual-only and must not terminate an otherwise healthy media session.
    }
  };
  publishAudioLevel().catch(() => undefined);
  options.owner.audioLevelTimer = setInterval(() => {
    publishAudioLevel().catch(() => undefined);
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
      if (owner.stopped) {
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
    async stop() {
      owner.stopPromise ??= (async () => {
        owner.stopped = true;
        owner.connected.reject(new Error("Global Voice WebRTC session stopped"));
        await stopOwnedMedia(owner);
      })();
      await owner.stopPromise;
      await owner.connected.promise.catch(() => undefined);
    },
  };
}

/** Owns Android microphone capture and remote GPT Live playback through one WebRTC peer. */
export const createGlobalSupervisorWebRtcSession: GlobalSupervisorWebRtcSessionFactory = async (
  options,
) => {
  const communicationAudio =
    options.mode === "interactive" ? await acquireGlobalVoiceCommunicationAudio() : null;
  let owner: WebRtcOwner | null = null;

  try {
    const { mediaDevices, RTCPeerConnection } = await import("react-native-webrtc");
    const peer = new RTCPeerConnection();
    const activeOwner: WebRtcOwner = {
      answerAccepted: false,
      audioLevelTimer: null,
      communicationAudio,
      connected: Promise.withResolvers<undefined>(),
      dataChannel: peer.createDataChannel("oai-events"),
      localStream: null,
      peer,
      stopped: false,
      stopPromise: null,
      terminalPublished: false,
    };
    owner = activeOwner;
    void activeOwner.connected.promise.catch(() => undefined);
    const onTerminal = (): void => {
      publishTerminal(activeOwner, options.onTerminal);
    };
    peer.onconnectionstatechange = () => {
      acceptConnectionChange(activeOwner, options.onTerminal);
    };
    await configureAudio({ mediaDevices, onTerminal, options, owner: activeOwner });
    await peer.setLocalDescription();
    await waitForIceGatheringComplete(peer);
    const offerSdp = peer.localDescription?.sdp;
    if (offerSdp === undefined || !validSdp(offerSdp)) {
      throw new Error("Global Voice WebRTC produced an invalid SDP offer");
    }
    return createPublicSession(activeOwner, offerSdp);
  } catch (error) {
    await cleanupFailedStartup(owner, communicationAudio);
    throw error;
  }
};
