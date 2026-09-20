import * as Crypto from "expo-crypto";
import { releasePersistentTerminalSession } from "expo-libghostty";
import { useSyncExternalStore } from "react";

import {
  closeNativeTerminal,
  openNativeTerminal,
  subscribeNativeTerminal,
  type NativeTerminalEvent,
  type NativeTerminalSession,
} from "../native/native-transport";
import { appLogger } from "../observability/logger";

export type InteractiveTerminalStatus = "connecting" | "open" | "closed" | "error";

export type InteractiveTerminalTab = {
  connectionId: string;
  cwd: string | null;
  error: string | null;
  id: string;
  status: InteractiveTerminalStatus;
  threadId: string;
  title: string;
};

export type InteractiveTerminalWorkspace = {
  activeId: string | null;
  tabs: readonly InteractiveTerminalTab[];
};

const EMPTY_WORKSPACE: InteractiveTerminalWorkspace = {
  activeId: null,
  tabs: [],
};
const workspaces = new Map<string, InteractiveTerminalWorkspace>();
const renderedOffsets = new Map<string, number>();
const listeners = new Set<() => void>();

subscribeNativeTerminal((event) => {
  applyNativeEvent(event);
});

export function useInteractiveTerminalWorkspace(
  connectionId: string | null,
  threadId: string | null,
): InteractiveTerminalWorkspace {
  const key = workspaceKey(connectionId, threadId);
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? EMPTY_WORKSPACE : (workspaces.get(key) ?? EMPTY_WORKSPACE)),
    () => EMPTY_WORKSPACE,
  );
}

export function readInteractiveTerminalWorkspace(
  connectionId: string,
  threadId: string,
): InteractiveTerminalWorkspace {
  return workspaces.get(requiredWorkspaceKey(connectionId, threadId)) ?? EMPTY_WORKSPACE;
}

export function readInteractiveTerminalRenderedOffset(terminalId: string): number {
  return renderedOffsets.get(terminalId) ?? 0;
}

export function commitInteractiveTerminalRenderedOffset(terminalId: string, offset: number): void {
  const previous = readInteractiveTerminalRenderedOffset(terminalId);
  if (!Number.isSafeInteger(offset) || offset < previous) {
    throw new Error("Terminal render offset is invalid");
  }
  renderedOffsets.set(terminalId, offset);
}

export function createInteractiveTerminalTab(input: {
  connectionId: string;
  cwd: string | null;
  threadId: string;
}): string {
  const key = requiredWorkspaceKey(input.connectionId, input.threadId);
  const current = workspaces.get(key) ?? EMPTY_WORKSPACE;
  const id = `terminal-${Crypto.randomUUID()}`;
  const tab: InteractiveTerminalTab = {
    connectionId: input.connectionId,
    cwd: input.cwd,
    error: null,
    id,
    status: "connecting",
    threadId: input.threadId,
    title: nextTabTitle(current.tabs),
  };
  setWorkspace(key, { activeId: id, tabs: [...current.tabs, tab] });
  void openNativeTerminal({
    cols: 80,
    connectionId: input.connectionId,
    cwd: input.cwd,
    rows: 24,
    sessionId: id,
    threadId: input.threadId,
  }).catch((error: unknown) => {
    updateTab(id, (candidate) => ({
      ...candidate,
      error: error instanceof Error ? error.message : "Could not open terminal",
      status: "error",
    }));
  });
  return id;
}

export function selectInteractiveTerminalTab(
  connectionId: string,
  threadId: string,
  terminalId: string,
): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined || !current.tabs.some(({ id }) => id === terminalId)) {
    return;
  }
  setWorkspace(key, { ...current, activeId: terminalId });
}

/** Rehydrates and focuses an existing native session without creating a terminal. */
export function focusInteractiveTerminalSession(session: NativeTerminalSession): void {
  const key = requiredWorkspaceKey(session.connectionId, session.threadId);
  const current = workspaces.get(key) ?? EMPTY_WORKSPACE;
  const existing = current.tabs.find(({ id }) => id === session.sessionId);
  if (existing !== undefined) {
    setWorkspace(key, { ...current, activeId: existing.id });
    return;
  }
  const tab: InteractiveTerminalTab = {
    connectionId: session.connectionId,
    cwd: session.cwd,
    error: null,
    id: session.sessionId,
    status: session.status,
    threadId: session.threadId,
    title: nextTabTitle(current.tabs),
  };
  setWorkspace(key, { activeId: tab.id, tabs: [...current.tabs, tab] });
}

export function closeInteractiveTerminalTab(
  connectionId: string,
  threadId: string,
  terminalId: string,
): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined) {
    return;
  }
  if (!current.tabs.some(({ id }) => id === terminalId)) {
    return;
  }
  closeInteractiveTerminalSession(terminalId);
}

/** Closes one native-owned session even when the JS tab projection was reloaded. */
export function closeInteractiveTerminalSession(terminalId: string): void {
  if (!removeTabById(terminalId)) {
    releaseTerminalRenderer(terminalId);
  }
  closeNativeTerminal(terminalId);
}

export function closeInteractiveTerminalWorkspace(connectionId: string, threadId: string): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined) {
    return;
  }
  workspaces.delete(key);
  emitChange();
  current.tabs.forEach(({ id }) => {
    releaseTerminalRenderer(id);
    closeNativeTerminal(id);
  });
}

function applyNativeEvent(event: NativeTerminalEvent): void {
  if (event.type === "output") {
    return;
  }
  if (event.type === "removed") {
    removeTabById(event.sessionId);
    return;
  }
  updateTab(event.sessionId, (tab) => {
    if (event.type === "open") {
      return { ...tab, error: null, status: "open" };
    }
    if (event.type === "closed") {
      return { ...tab, status: "closed" };
    }
    if (event.type === "error") {
      return { ...tab, error: event.message ?? "Terminal connection failed", status: "error" };
    }
    return { ...tab, error: null, status: "connecting" };
  });
}

function updateTab(
  id: string,
  update: (tab: InteractiveTerminalTab) => InteractiveTerminalTab,
): void {
  for (const [key, workspace] of workspaces) {
    const index = workspace.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) {
      continue;
    }
    const tabs = [...workspace.tabs];
    const current = tabs[index];
    if (current === undefined) {
      return;
    }
    tabs[index] = update(current);
    setWorkspace(key, { ...workspace, tabs });
    return;
  }
}

function removeTabById(id: string): boolean {
  for (const [key, workspace] of workspaces) {
    const index = workspace.tabs.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      continue;
    }
    const tabs = workspace.tabs.filter((candidate) => candidate.id !== id);
    if (tabs.length === 0) {
      workspaces.delete(key);
    } else {
      setWorkspace(key, {
        activeId:
          workspace.activeId === id
            ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
            : workspace.activeId,
        tabs,
      });
    }
    releaseTerminalRenderer(id);
    if (tabs.length === 0) {
      emitChange();
    }
    return true;
  }
  return false;
}

function releaseTerminalRenderer(id: string): void {
  renderedOffsets.delete(id);
  void releasePersistentTerminalSession(id).catch((error: unknown) => {
    appLogger.warnCaught({
      error: error,
      event: "terminal.persistent_renderer_release.failed",
      fields: { terminalId: id },
    });
  });
}

function setWorkspace(key: string, workspace: InteractiveTerminalWorkspace): void {
  workspaces.set(key, workspace);
  emitChange();
}

function nextTabTitle(tabs: readonly InteractiveTerminalTab[]): string {
  const titles = new Set(tabs.map(({ title }) => title));
  let index = 1;
  while (titles.has(`Terminal ${String(index)}`)) {
    index += 1;
  }
  return `Terminal ${String(index)}`;
}

function workspaceKey(connectionId: string | null, threadId: string | null): string | null {
  return connectionId === null || threadId === null
    ? null
    : requiredWorkspaceKey(connectionId, threadId);
}

function requiredWorkspaceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange(): void {
  listeners.forEach((listener) => {
    listener();
  });
}
