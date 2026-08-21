import * as Crypto from "expo-crypto";
import { releasePersistentTerminalSession } from "expo-libghostty";
import { useSyncExternalStore } from "react";

import {
  closeNativeTerminal,
  openNativeTerminal,
  subscribeNativeTerminal,
  type NativeTerminalEvent,
} from "../native/native-transport";

export type InteractiveTerminalStatus = "connecting" | "open" | "closed" | "error";

export type InteractiveTerminalTab = {
  id: string;
  connectionId: string;
  threadId: string;
  cwd: string | null;
  title: string;
  status: InteractiveTerminalStatus;
  error: string | null;
};

export type InteractiveTerminalWorkspace = {
  tabs: readonly InteractiveTerminalTab[];
  activeId: string | null;
};

const EMPTY_WORKSPACE: InteractiveTerminalWorkspace = Object.freeze({ tabs: Object.freeze([]), activeId: null });
const workspaces = new Map<string, InteractiveTerminalWorkspace>();
const renderedOffsets = new Map<string, number>();
const listeners = new Set<() => void>();

subscribeNativeTerminal((event) => applyNativeEvent(event));

export function useInteractiveTerminalWorkspace(
  connectionId: string | null,
  threadId: string | null,
): InteractiveTerminalWorkspace {
  const key = workspaceKey(connectionId, threadId);
  return useSyncExternalStore(
    subscribe,
    () => key === null ? EMPTY_WORKSPACE : workspaces.get(key) ?? EMPTY_WORKSPACE,
    () => EMPTY_WORKSPACE,
  );
}

export function readInteractiveTerminalWorkspace(connectionId: string, threadId: string): InteractiveTerminalWorkspace {
  return workspaces.get(requiredWorkspaceKey(connectionId, threadId)) ?? EMPTY_WORKSPACE;
}

export function readInteractiveTerminalRenderedOffset(terminalId: string): number {
  return renderedOffsets.get(terminalId) ?? 0;
}

export function commitInteractiveTerminalRenderedOffset(terminalId: string, offset: number): void {
  const previous = readInteractiveTerminalRenderedOffset(terminalId);
  if (!Number.isSafeInteger(offset) || offset < previous) throw new Error("Terminal render offset is invalid");
  renderedOffsets.set(terminalId, offset);
}

export function createInteractiveTerminalTab(input: {
  connectionId: string;
  threadId: string;
  cwd: string | null;
}): string {
  const key = requiredWorkspaceKey(input.connectionId, input.threadId);
  const current = workspaces.get(key) ?? EMPTY_WORKSPACE;
  const id = `terminal-${Crypto.randomUUID()}`;
  const tab: InteractiveTerminalTab = {
    id,
    connectionId: input.connectionId,
    threadId: input.threadId,
    cwd: input.cwd,
    title: nextTabTitle(current.tabs),
    status: "connecting",
    error: null,
  };
  setWorkspace(key, { tabs: [...current.tabs, tab], activeId: id });
  void openNativeTerminal({
    sessionId: id,
    connectionId: input.connectionId,
    threadId: input.threadId,
    cwd: input.cwd,
    cols: 80,
    rows: 24,
  }).catch((cause) => {
    updateTab(id, (candidate) => ({
      ...candidate,
      status: "error",
      error: cause instanceof Error ? cause.message : "Could not open terminal",
    }));
  });
  return id;
}

export function selectInteractiveTerminalTab(connectionId: string, threadId: string, terminalId: string): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined || !current.tabs.some(({ id }) => id === terminalId)) return;
  setWorkspace(key, { ...current, activeId: terminalId });
}

export function closeInteractiveTerminalTab(connectionId: string, threadId: string, terminalId: string): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined) return;
  const index = current.tabs.findIndex(({ id }) => id === terminalId);
  if (index < 0) return;
  const tabs = current.tabs.filter(({ id }) => id !== terminalId);
  const activeId = current.activeId === terminalId
    ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null
    : current.activeId;
  if (tabs.length === 0) {
    workspaces.delete(key);
    emitChange();
  } else {
    setWorkspace(key, { tabs, activeId });
  }
  releaseTerminalRenderer(terminalId);
  closeNativeTerminal(terminalId);
}

export function closeInteractiveTerminalWorkspace(connectionId: string, threadId: string): void {
  const key = requiredWorkspaceKey(connectionId, threadId);
  const current = workspaces.get(key);
  if (current === undefined) return;
  workspaces.delete(key);
  emitChange();
  current.tabs.forEach(({ id }) => {
    releaseTerminalRenderer(id);
    closeNativeTerminal(id);
  });
}

function applyNativeEvent(event: NativeTerminalEvent): void {
  if (event.type === "output") return;
  if (event.type === "removed") {
    removeTabById(event.sessionId);
    return;
  }
  updateTab(event.sessionId, (tab) => {
    if (event.type === "open") return { ...tab, status: "open", error: null };
    if (event.type === "closed") return { ...tab, status: "closed" };
    if (event.type === "error") return { ...tab, status: "error", error: event.message ?? "Terminal connection failed" };
    return { ...tab, status: "connecting", error: null };
  });
}

function updateTab(id: string, update: (tab: InteractiveTerminalTab) => InteractiveTerminalTab): void {
  for (const [key, workspace] of workspaces) {
    const index = workspace.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) continue;
    const tabs = [...workspace.tabs];
    const current = tabs[index];
    if (current === undefined) return;
    tabs[index] = update(current);
    setWorkspace(key, { ...workspace, tabs });
    return;
  }
}

function removeTabById(id: string): void {
  for (const [key, workspace] of workspaces) {
    const index = workspace.tabs.findIndex((candidate) => candidate.id === id);
    if (index < 0) continue;
    const tabs = workspace.tabs.filter((candidate) => candidate.id !== id);
    if (tabs.length === 0) workspaces.delete(key);
    else setWorkspace(key, {
      tabs,
      activeId: workspace.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : workspace.activeId,
    });
    releaseTerminalRenderer(id);
    if (tabs.length === 0) emitChange();
    return;
  }
}

function releaseTerminalRenderer(id: string): void {
  renderedOffsets.delete(id);
  void releasePersistentTerminalSession(id).catch((cause: unknown) => {
    console.warn("Could not release persistent terminal renderer", cause);
  });
}

function setWorkspace(key: string, workspace: InteractiveTerminalWorkspace): void {
  workspaces.set(key, workspace);
  emitChange();
}

function nextTabTitle(tabs: readonly InteractiveTerminalTab[]): string {
  const titles = new Set(tabs.map(({ title }) => title));
  let index = 1;
  while (titles.has(`Terminal ${index}`)) index += 1;
  return `Terminal ${index}`;
}

function workspaceKey(connectionId: string | null, threadId: string | null): string | null {
  return connectionId === null || threadId === null ? null : requiredWorkspaceKey(connectionId, threadId);
}

function requiredWorkspaceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}
