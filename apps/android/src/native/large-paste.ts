import { DeviceEventEmitter, NativeModules } from "react-native";

export type LargePasteEvent = {
  text: string;
  start: number;
  end: number;
};

type NativeLargePasteEvent = LargePasteEvent & { token?: string };

type NativeLargePasteModule = {
  install(reactTag: number, token: string, minimumChars: number): void;
  uninstall(reactTag: number, token: string): void;
};

const callbacks = new Map<string, (event: LargePasteEvent) => void>();
let nativeSubscription: { remove(): void } | null = null;

function bridge(): NativeLargePasteModule | null {
  const candidate = NativeModules.CodeWideLargePaste as Partial<NativeLargePasteModule> | undefined;
  return typeof candidate?.install === "function" && typeof candidate.uninstall === "function"
    ? candidate as NativeLargePasteModule
    : null;
}

function ensureNativeSubscription(): void {
  if (nativeSubscription !== null) return;
  nativeSubscription = DeviceEventEmitter.addListener("codewideLargePaste", (event: NativeLargePasteEvent) => {
    if (typeof event.token !== "string" || typeof event.text !== "string") return;
    callbacks.get(event.token)?.({
      text: event.text,
      start: Number.isFinite(event.start) ? event.start : 0,
      end: Number.isFinite(event.end) ? event.end : 0,
    });
  });
}

export function installLargePasteInterceptor(
  reactTag: number,
  token: string,
  minimumChars: number,
  callback: (event: LargePasteEvent) => void,
): (() => void) | null {
  const nativeBridge = bridge();
  if (nativeBridge === null) return null;
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
