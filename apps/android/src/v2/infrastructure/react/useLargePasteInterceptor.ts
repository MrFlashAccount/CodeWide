import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import { DeviceEventEmitter, findNodeHandle, NativeModules, type TextInput } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { LargePasteEvent } from "../../application/composer/composerAttachmentTypes";

interface NativeLargePasteEvent extends LargePasteEvent {
  token?: string;
}

interface NativeLargePasteModule {
  install(reactTag: number, token: string, minimumChars: number): void;
  uninstall(reactTag: number, token: string): void;
}

const callbacks = new Map<string, (event: LargePasteEvent) => void>();
let nativeSubscription: { remove(): void } | null = null;

/** Registers the Android clipboard interceptor before TextInput receives a large paste. */
export function useLargePasteInterceptor(
  inputRef: RefObject<TextInput | null>,
  minimumChars: number,
  onLargePaste: (event: LargePasteEvent) => void,
): void {
  const generatedId = useId();
  const callback = useEvent(onLargePaste);
  const tokenRef = useRef(`v2-large-paste-${generatedId}`);
  useLayoutEffect(() => {
    const nativeBridge = bridge();
    const reactTag = findNodeHandle(inputRef.current);
    if (nativeBridge === null || reactTag === null) return undefined;
    ensureSubscription();
    const token = tokenRef.current;
    callbacks.set(token, callback);
    nativeBridge.install(reactTag, token, minimumChars);
    return () => uninstall(nativeBridge, reactTag, token);
  }, [callback, inputRef, minimumChars]);
}

function bridge(): NativeLargePasteModule | null {
  const candidate = NativeModules["CodeWideLargePaste"] as
    | Partial<NativeLargePasteModule>
    | undefined;
  if (typeof candidate?.install !== "function" || typeof candidate.uninstall !== "function") {
    return null;
  }
  return candidate as NativeLargePasteModule;
}

function ensureSubscription(): void {
  if (nativeSubscription !== null) return;
  nativeSubscription = DeviceEventEmitter.addListener(
    "codewideLargePaste",
    (event: NativeLargePasteEvent) => {
      if (typeof event.token !== "string" || typeof event.text !== "string") return;
      callbacks.get(event.token)?.({
        end: Number.isFinite(event.end) ? event.end : 0,
        start: Number.isFinite(event.start) ? event.start : 0,
        text: event.text,
      });
    },
  );
}

function uninstall(nativeBridge: NativeLargePasteModule, reactTag: number, token: string): void {
  callbacks.delete(token);
  nativeBridge.uninstall(reactTag, token);
  if (callbacks.size !== 0) return;
  nativeSubscription?.remove();
  nativeSubscription = null;
}
