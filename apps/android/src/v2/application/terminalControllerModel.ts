import type { V2U64 } from "@codewide/sync-client/v2";

import type { TerminalTransportHandle } from "./ports/terminalTransport";
import type {
  TerminalContextSnapshot,
  TerminalOverview,
  TerminalSession,
  TerminalWorkspace,
} from "../domain/terminalSession";
import type { QualifiedThread } from "../domain/qualifiedThread";

export interface ManagedTerminal {
  cols: number;
  connection: TerminalTransportHandle | null;
  connectionVersion: number;
  createOnConnect: boolean;
  generation: V2U64;
  latestOffset: V2U64;
  missedOutput: boolean;
  model: TerminalSession;
  processExited: boolean;
  reconnectAttempt: number;
  renderedOffset: V2U64;
  rendering: Promise<void>;
  rendererCount: number;
  rendererWasAttached: boolean;
  retryCancellation: (() => void) | null;
  rows: number;
  settled: boolean;
}

export interface ManagedWorkspace {
  activeId: string | null;
  context: TerminalContextSnapshot;
  owner: QualifiedThread;
  sessions: ManagedTerminal[];
  snapshot: TerminalWorkspace;
}

export const EMPTY_TERMINAL_CONTEXT: TerminalContextSnapshot = {
  errorCount: 0,
  liveCount: 0,
  sessionCount: 0,
};

export const EMPTY_TERMINAL_OVERVIEW: TerminalOverview = { sessionCount: 0, workspaces: [] };

export function nextTerminalTitle(sessions: readonly ManagedTerminal[]): string {
  const titles = new Set(sessions.map((candidate) => candidate.model.title));
  let ordinal = 1;
  while (titles.has(`Terminal ${ordinal}`)) ordinal += 1;
  return `Terminal ${ordinal}`;
}

export function terminalWorkspaceKey(owner: QualifiedThread): string {
  return `${owner.savedServerId}\u0000${owner.threadId}`;
}

export function compareTerminalOffset(left: V2U64, right: V2U64): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}
