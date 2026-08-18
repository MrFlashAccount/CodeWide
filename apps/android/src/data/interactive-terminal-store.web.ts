import { useSyncExternalStore } from "react";

import type { InteractiveTerminalWorkspace } from "./interactive-terminal-store.native";

export type { InteractiveTerminalStatus, InteractiveTerminalTab, InteractiveTerminalWorkspace } from "./interactive-terminal-store.native";

const EMPTY_WORKSPACE: InteractiveTerminalWorkspace = { tabs: [], activeId: null };
const subscribe = () => () => undefined;

export function useInteractiveTerminalWorkspace(_connectionId: string | null, _threadId: string | null): InteractiveTerminalWorkspace {
  return useSyncExternalStore(subscribe, () => EMPTY_WORKSPACE, () => EMPTY_WORKSPACE);
}
export function readInteractiveTerminalWorkspace(_connectionId: string, _threadId: string): InteractiveTerminalWorkspace { return EMPTY_WORKSPACE; }

export function createInteractiveTerminalTab(_input: { connectionId: string; threadId: string; cwd: string | null }): string { throw new Error("Terminal is available on Android only"); }
export function selectInteractiveTerminalTab(_connectionId: string, _threadId: string, _terminalId: string): void {}
export function closeInteractiveTerminalTab(_connectionId: string, _threadId: string, _terminalId: string): void {}
export function closeInteractiveTerminalWorkspace(_connectionId: string, _threadId: string): void {}
