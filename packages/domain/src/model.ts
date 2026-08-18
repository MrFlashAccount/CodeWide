import type { ThreadItem, ThreadStatus, TurnStatus } from "@codewide/codex-protocol/v0.147.0/v2";

export type ConnectionId = string & { readonly __connectionId: unique symbol };

export type ConnectionState =
  | "offline"
  | "connecting"
  | "syncing"
  | "live"
  | "degraded"
  | "authRequired";

export type ConnectionProfile = {
  id: ConnectionId;
  displayName: string;
  emoji: string;
  endpoint: string;
  enabled: boolean;
  sortOrder: number;
  state: ConnectionState;
  lastSeenAt: number | null;
  syncCursor: string | null;
};

export type NormalizedItem = {
  key: string;
  connectionId: ConnectionId;
  threadId: string;
  turnId: string;
  itemId: string;
  type: string;
  payload: ThreadItem | Record<string, unknown>;
  unknown: boolean;
};

export type NormalizedTurn = {
  key: string;
  id: string;
  status: TurnStatus;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  items: NormalizedItem[];
};

export type NormalizedThread = {
  key: string;
  connectionId: ConnectionId;
  remoteId: string;
  name: string | null;
  preview: string;
  cwd: string;
  updatedAt: number;
  recencyAt: number | null;
  status: ThreadStatus;
  turns: NormalizedTurn[];
};

export type DomainSnapshot = {
  connections: ConnectionProfile[];
  threads: NormalizedThread[];
};

