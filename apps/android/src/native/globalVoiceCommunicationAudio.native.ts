import { NativeModules } from "react-native";

import type { GlobalVoiceCommunicationAudioLease } from "./globalVoiceCommunicationAudioContract";

type GlobalVoiceCommunicationAudioBridge = {
  readonly acquire: () => Promise<unknown>;
  readonly release: (token: string) => Promise<unknown>;
};

const MAX_COMMUNICATION_AUDIO_TOKEN_CHARACTERS = 128;

function requireBridge(): GlobalVoiceCommunicationAudioBridge {
  // WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bridge = NativeModules.CodeWideGlobalVoiceCommunicationAudio as
    | GlobalVoiceCommunicationAudioBridge
    | undefined;
  if (bridge === undefined) {
    throw new Error("Global Voice communication audio is unavailable in this build");
  }
  return bridge;
}

/** Acquires Android communication mode before the interactive WebRTC peer is opened. */
export async function acquireGlobalVoiceCommunicationAudio(): Promise<GlobalVoiceCommunicationAudioLease> {
  const bridge = requireBridge();
  const token = await bridge.acquire();
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_COMMUNICATION_AUDIO_TOKEN_CHARACTERS
  ) {
    throw new Error("Global Voice communication audio returned an invalid token");
  }
  let releasePromise: Promise<void> | null = null;
  return {
    async release(): Promise<void> {
      releasePromise ??= bridge.release(token).then(() => undefined);
      await releasePromise;
    },
  };
}
