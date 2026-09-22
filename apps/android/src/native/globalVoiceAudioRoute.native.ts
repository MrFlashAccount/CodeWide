import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";

import {
  decodeVoiceInputSnapshot,
  type GlobalVoiceAudioRouteLease,
  type VoiceInputKind,
  type VoiceInputSnapshot,
} from "./globalVoiceAudioRouteContract";

const ANDROID_BLUETOOTH_PERMISSION_API = 31;

type AudioRouteBridge = {
  readonly acquire: (muted: boolean) => Promise<unknown>;
  readonly addListener: (eventName: string) => void;
  readonly getSnapshot: () => Promise<unknown>;
  readonly release: (token: string) => Promise<void>;
  readonly removeListeners: (count: number) => void;
  readonly select: (kind: VoiceInputKind, id: number | null) => Promise<unknown>;
  readonly setMuted: (token: string, muted: boolean) => Promise<void>;
};

function bridge(): AudioRouteBridge {
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceAudioRoute;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Microphone routing requires an updated Android app");
  }
  // WHY: React Native owns this same-binary module registry; no generated TS spec exists.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as AudioRouteBridge;
}

/** Reads current devices and actual recording route without acquiring audio ownership. */
export async function readGlobalVoiceAudioInput(): Promise<VoiceInputSnapshot> {
  return decodeVoiceInputSnapshot(await bridge().getSnapshot());
}

/** Observes device changes and actual routing independently of settings visibility. */
export function subscribeGlobalVoiceAudioInput(
  onChange: (snapshot: VoiceInputSnapshot) => void,
): () => void {
  const subscription = new NativeEventEmitter(bridge()).addListener(
    "CodeWideGlobalVoiceAudioRouteChanged",
    (value: unknown) => {
      onChange(decodeVoiceInputSnapshot(value));
    },
  );
  return () => {
    subscription.remove();
  };
}

/** Persists route kind only, resolving an optional device id for this connection. */
export async function selectGlobalVoiceAudioInput(
  kind: VoiceInputKind,
  id: number | null,
): Promise<VoiceInputSnapshot> {
  if (
    (kind === "bluetooth" || kind === "ble") &&
    Number(Platform.Version) >= ANDROID_BLUETOOTH_PERMISSION_API
  ) {
    const permission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
    if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error("Bluetooth access is required to select this microphone");
    }
  }
  return decodeVoiceInputSnapshot(await bridge().select(kind, id));
}

/** Acquires input/communication overrides only for an interactive Global Voice WebRTC owner. */
export async function acquireGlobalVoiceAudioRoute(
  muted: boolean,
): Promise<GlobalVoiceAudioRouteLease> {
  const native = bridge();
  const token = await native.acquire(muted);
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Invalid microphone route lease");
  }
  return {
    release: async () => {
      await native.release(token);
    },
    setMuted: async (next) => {
      await native.setMuted(token, next);
    },
  };
}
