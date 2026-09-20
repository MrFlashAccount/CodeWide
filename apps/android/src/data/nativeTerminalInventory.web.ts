import { useSyncExternalStore } from "react";

import type { NativeTerminalInventorySnapshot } from "./nativeTerminalInventory.types";

const EMPTY_SNAPSHOT: NativeTerminalInventorySnapshot = { sessions: [], status: "ready" };
const subscribe = (): (() => void) => () => undefined;

export function useNativeTerminalInventory(): NativeTerminalInventorySnapshot {
  return useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
}

export async function refreshNativeTerminalInventory(): Promise<void> {
  await Promise.resolve();
}

function readSnapshot(): NativeTerminalInventorySnapshot {
  return EMPTY_SNAPSHOT;
}
