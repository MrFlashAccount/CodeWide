import { useSyncExternalStore } from "react";

import {
  listNativeTerminals,
  subscribeNativeTerminal,
  type NativeTerminalSession,
} from "../native/native-transport";
import type { NativeTerminalInventorySnapshot } from "./nativeTerminalInventory.types";

const IDLE_SNAPSHOT: NativeTerminalInventorySnapshot = { sessions: [], status: "idle" };
const listeners = new Set<() => void>();
let snapshot: NativeTerminalInventorySnapshot = IDLE_SNAPSHOT;
let loading: Promise<void> | null = null;

subscribeNativeTerminal((event) => {
  if (event.type === "removed" || event.type === "closed" || event.type === "error") {
    removeSession(event.sessionId);
    return;
  }
  if (event.type === "connecting" || event.type === "open") {
    const status: NativeTerminalSession["status"] = event.type;
    const index = snapshot.sessions.findIndex(({ sessionId }) => sessionId === event.sessionId);
    if (index >= 0) {
      publish({
        sessions: snapshot.sessions.map((session, candidateIndex) =>
          candidateIndex === index ? { ...session, status } : session,
        ),
        status: "ready",
      });
    } else if (snapshot.status !== "idle") {
      void refreshNativeTerminalInventory().catch(() => undefined);
    }
  }
});

export function useNativeTerminalInventory(): NativeTerminalInventorySnapshot {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}

/** Refreshes the presentation cache from the Android lifecycle owner. */
export async function refreshNativeTerminalInventory(): Promise<void> {
  if (loading !== null) {
    await loading;
    return;
  }
  publish({ sessions: snapshot.sessions, status: "loading" });
  loading = listNativeTerminals()
    .then((sessions) => {
      publish({ sessions, status: "ready" });
    })
    .catch((error: unknown) => {
      publish({
        message: error instanceof Error ? error.message : "Could not load terminals",
        sessions: snapshot.sessions,
        status: "error",
      });
      throw error;
    })
    .finally(() => {
      loading = null;
    });
  await loading;
}

function removeSession(sessionId: string): void {
  const sessions = snapshot.sessions.filter((session) => session.sessionId !== sessionId);
  if (sessions.length === snapshot.sessions.length) {
    return;
  }
  publish({ sessions, status: "ready" });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSnapshot(): NativeTerminalInventorySnapshot {
  return snapshot;
}

function readServerSnapshot(): NativeTerminalInventorySnapshot {
  return IDLE_SNAPSHOT;
}

function publish(next: NativeTerminalInventorySnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => {
    listener();
  });
}
