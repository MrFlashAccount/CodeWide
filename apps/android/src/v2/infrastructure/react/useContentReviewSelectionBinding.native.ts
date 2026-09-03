import { useLayoutEffect, useRef, type ComponentRef, type RefObject } from "react";
import { DeviceEventEmitter, findNodeHandle, NativeModules } from "react-native";
import type { Text as NativeText } from "react-native";

import type {
  ContentReviewSelection,
  ContentReviewSelectionBindingInput,
} from "./contentReviewSelectionBinding";

interface ContentReviewNativeModule {
  install(reactTag: number, token: string): void;
  uninstall(reactTag: number, token: string): void;
}

const callbacks = new Map<string, (selection: ContentReviewSelection) => void>();
let nativeSubscription: { remove(): void } | null = null;

/** Synchronizes one native Text selection action with the V2 review capability. */
export function useContentReviewSelectionBinding(
  input: ContentReviewSelectionBindingInput,
): RefObject<ComponentRef<typeof NativeText> | null> {
  const { enabled, onSelection, token } = input;
  const textRef = useRef<ComponentRef<typeof NativeText> | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const nativeModule = contentReviewNativeModule(NativeModules["CodeWideContentReview"]);
    const reactTag = findNodeHandle(textRef.current);
    if (nativeModule === null || reactTag === null) return undefined;
    ensureNativeSubscription();
    callbacks.set(token, onSelection);
    nativeModule.install(reactTag, token);
    return () => {
      callbacks.delete(token);
      nativeModule.uninstall(reactTag, token);
      releaseNativeSubscriptionIfUnused();
    };
  }, [enabled, onSelection, token]);
  return textRef;
}

function ensureNativeSubscription(): void {
  if (nativeSubscription !== null) return;
  nativeSubscription = DeviceEventEmitter.addListener(
    "codewideContentReviewSelection",
    (value: unknown) => {
      const selection = parseSelection(value);
      if (selection === null) return;
      callbacks.get(selection.token)?.(selection);
    },
  );
}

function releaseNativeSubscriptionIfUnused(): void {
  if (callbacks.size !== 0) return;
  nativeSubscription?.remove();
  nativeSubscription = null;
}

function contentReviewNativeModule(value: unknown): ContentReviewNativeModule | null {
  if (!isRecord(value)) return null;
  const install = value["install"];
  const uninstall = value["uninstall"];
  if (typeof install !== "function" || typeof uninstall !== "function") return null;
  return {
    install(reactTag, token) {
      Reflect.apply(install, value, [reactTag, token]);
    },
    uninstall(reactTag, token) {
      Reflect.apply(uninstall, value, [reactTag, token]);
    },
  };
}

function parseSelection(value: unknown): (ContentReviewSelection & { token: string }) | null {
  if (!isRecord(value)) return null;
  const token = value["token"];
  const text = value["text"];
  const start = value["start"];
  const end = value["end"];
  if (
    typeof token !== "string" ||
    typeof text !== "string" ||
    typeof start !== "number" ||
    typeof end !== "number"
  ) {
    return null;
  }
  return { end, start, text, token };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object";
}
