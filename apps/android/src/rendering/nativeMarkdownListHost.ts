import { useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Platform,
  requireNativeComponent,
  UIManager,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";

import { usePerformanceExperiment } from "../data/performance-experiments";
import type { MarkdownListLine } from "./markdownListGroups";

/** Paragraph-relative UTF-16 offsets from the Android selection toolbar. */
export type ListSelection = Readonly<{ end: number; index: number; start: number }>;
type ListProps = ViewProps & {
  content: {
    checkedColor: string;
    font: string;
    fontSize: number;
    gap: number;
    iconSize: number;
    inset: number;
    lineHeight: number;
    lines: readonly MarkdownListLine[];
    markerColor: string;
    markerGap: number;
    nestedGap: number;
    review: boolean;
    textColor: string;
  };
  onListHeight: (event: NativeSyntheticEvent<{ height: number }>) => void;
  onListSelection: (event: NativeSyntheticEvent<ListSelection>) => void;
};

const hostName = "CodeWideMarkdownList";
/** Absent on older Android shells and web. */
export const MarkdownListHost =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(hostName)
    ? requireNativeComponent<ListProps>(hostName)
    : null;
const listeners = new Set<() => void>();
let screenReader = true;

function publishScreenReader(enabled: boolean): void {
  if (enabled === screenReader) {
    return;
  }
  screenReader = enabled;
  for (const listener of listeners) {
    listener();
  }
}

// Read before navigating into history. TalkBack keeps the existing individually accessible items.
function observeScreenReader(): void {
  let changed = false;
  AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
    changed = true;
    publishScreenReader(enabled);
  });
  void AccessibilityInfo.isScreenReaderEnabled()
    .then((enabled) => {
      if (!changed) {
        publishScreenReader(enabled);
      }
    })
    .catch(() => undefined);
}

if (MarkdownListHost !== null) {
  observeScreenReader();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getScreenReader(): boolean {
  return screenReader;
}

/** Reading order and individual task labels belong to the standard rich list with TalkBack. */
export function useListScreenReader(): boolean {
  return useSyncExternalStore(subscribe, getScreenReader, getScreenReader);
}

/** Enables grouped projection only when the viewport supports native list text layout. */
export function useNativeListGroups(exactRowMeasurement: boolean): boolean {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  return MarkdownListHost !== null && !exactRowMeasurement && !plainText;
}
