import { DeviceEventEmitter, NativeModules } from "react-native";
import { unknownRecord } from "../data/unknownRecord";

export type LargePasteEvent = {
  end: number;
  start: number;
  text: string;
};

type NativeLargePasteEvent = LargePasteEvent & { token?: string };

type NativeLargePasteModule = {
  install: (reactTag: number, token: string, minimumChars: number) => void;
  uninstall: (reactTag: number, token: string) => void;
};

const callbacks = new Map<string, (event: LargePasteEvent) => void>();
let nativeSubscription: { remove: () => void } | null = null;

function bridge(): NativeLargePasteModule | null {
  const candidate = unknownRecord(NativeModules.CodeWideLargePaste);
  if (
    candidate === null ||
    typeof candidate.install !== "function" ||
    typeof candidate.uninstall !== "function"
  ) {
    return null;
  }
  // WHY: React Native exposes callable native methods without parameter metadata after registration; presence is the only runtime capability check available.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as NativeLargePasteModule;
}

function ensureNativeSubscription(): void {
  if (nativeSubscription !== null) {
    return;
  }
  nativeSubscription = DeviceEventEmitter.addListener(
    "codewideLargePaste",
    (event: NativeLargePasteEvent) => {
      if (typeof event.token !== "string" || typeof event.text !== "string") {
        return;
      }
      callbacks.get(event.token)?.({
        end: Number.isFinite(event.end) ? event.end : 0,
        start: Number.isFinite(event.start) ? event.start : 0,
        text: event.text,
      });
    },
  );
}

export function installLargePasteInterceptor(
  reactTag: number,
  token: string,
  minimumChars: number,
  callback: (event: LargePasteEvent) => void,
): (() => void) | null {
  const nativeBridge = bridge();
  if (nativeBridge === null) {
    return null;
  }
  ensureNativeSubscription();
  callbacks.set(token, callback);
  nativeBridge.install(reactTag, token, minimumChars);
  return () => {
    callbacks.delete(token);
    nativeBridge.uninstall(reactTag, token);
    if (callbacks.size === 0) {
      nativeSubscription?.remove();
      nativeSubscription = null;
    }
  };
}
