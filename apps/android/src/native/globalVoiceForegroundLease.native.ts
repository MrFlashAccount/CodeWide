import { NativeModules } from "react-native";
import {
  activateGlobalVoiceOverlayActions,
  releaseGlobalVoiceOverlayActions,
} from "./globalVoiceOverlayActionLease";

type GlobalVoiceForegroundBridge = {
  readonly acquire: () => Promise<unknown>;
  readonly release: (token: string) => Promise<void>;
  readonly setPlaybackLevel: (token: string, level: number) => void;
};

const MAX_FOREGROUND_TOKEN_CHARACTERS = 128;

/** Exact Android foreground-service lease owned by one interactive WebRTC session. */
export type GlobalVoiceForegroundLease = {
  readonly release: () => Promise<void>;
  readonly setPlaybackLevel: (level: number) => void;
};

function requireBridge(): GlobalVoiceForegroundBridge {
  // WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bridge = NativeModules.CodeWideGlobalVoiceForeground as
    | GlobalVoiceForegroundBridge
    | undefined;
  if (bridge === undefined) {
    throw new Error("Global Voice foreground service is unavailable in this build");
  }
  return bridge;
}

/** Acquires Android microphone foreground authority before microphone capture begins. */
export async function acquireGlobalVoiceForegroundLease(): Promise<GlobalVoiceForegroundLease> {
  const bridge = requireBridge();
  const token = await bridge.acquire();
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_FOREGROUND_TOKEN_CHARACTERS
  ) {
    throw new Error("Global Voice foreground service returned an invalid token");
  }
  let releasePromise: Promise<void> | null = null;
  activateGlobalVoiceOverlayActions(token);
  return {
    async release(): Promise<void> {
      releaseGlobalVoiceOverlayActions(token);
      releasePromise ??= bridge.release(token);
      await releasePromise;
    },
    setPlaybackLevel(level): void {
      bridge.setPlaybackLevel(token, Math.max(0, Math.min(1, level)));
    },
  };
}
