import type { V2TransportError } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "./qualifiedThread";

export const MAX_TERMINAL_TABS = 8;

export type TerminalSessionStatus = "connecting" | "live" | "closed" | "failed";

export interface TerminalSession {
  readonly cwd: string | null;
  readonly error: string | null;
  readonly errorCode: V2TransportError["code"] | null;
  readonly exitCode: number | null;
  readonly id: string;
  readonly owner: QualifiedThread;
  readonly signal: string | null;
  readonly status: TerminalSessionStatus;
  readonly title: string;
}

export interface TerminalWorkspace {
  readonly activeId: string | null;
  readonly owner: QualifiedThread;
  readonly sessions: readonly TerminalSession[];
}

export interface TerminalWorkspaceSummary {
  readonly errorCount: number;
  readonly liveCount: number;
  readonly owner: QualifiedThread;
  readonly sessionCount: number;
}

export interface TerminalOverview {
  readonly sessionCount: number;
  readonly workspaces: readonly TerminalWorkspaceSummary[];
}

export interface TerminalContextSnapshot {
  readonly errorCount: number;
  readonly liveCount: number;
  readonly sessionCount: number;
}
