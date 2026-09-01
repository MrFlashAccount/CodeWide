import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection, type Collection } from "@tanstack/react-db";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";

import { createTurnControlsCollection } from "./turn-controls-collection";
import { createThreadHistoryModel, type ThreadHistoryModel, type ThreadHistoryRow } from "./thread-history-model";
import type { TurnControlsRow } from "./turn-controls-types";
import { createThreadResourcesModel, type ThreadResourcesModel } from "./thread-resources-model";

export type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";

export type { ThreadHistoryRow } from "./thread-history-model";

export type BackgroundTerminalValue = {
  itemId: string;
  processId: string;
  command: string;
  cwd: string;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: string | null;
};

export type BackgroundTerminalsRow = {
  id: string;
  connectionId: string;
  threadId: string;
  status: "loading" | "ready" | "error";
  items: BackgroundTerminalValue[];
  error: string | null;
  updatedAt: number;
};

export type ThreadGoalRow = {
  id: string;
  connectionId: string;
  threadId: string;
  status: "loading" | "ready" | "error";
  goal: ThreadGoal | null;
  error: string | null;
  updatedAt: number;
};

export type TunnelValue = { id: string; url: string; expiresAt: number; authorization: string };

export type TunnelRow = {
  id: string;
  connectionId: string;
  status: "creating" | "ready" | "revoking" | "error";
  tunnel: TunnelValue | null;
  error: string | null;
  updatedAt: number;
};

export type VoiceInputRow = {
  id: string;
  scope: string;
  phase: "idle" | "starting" | "recording" | "finishing";
  backend: "remote" | "android";
  level: number;
  seconds: number;
  error: string | null;
  retryAvailable: boolean;
  pendingSelection: { start: number; end: number } | null;
  updatedAt: number;
};

export type FileTransferRow = {
  id: string;
  scope: string;
  status: "idle" | "authorizing" | "running" | "complete" | "error";
  progress: { transferred: number; total: number; phase: "hashing" | "transferring" | "verifying" } | null;
  result: string | null;
  error: string | null;
  updatedAt: number;
};

export type ThreadChangeResource = {
  path: string;
  kind: "add" | "delete" | "update";
  availability: "available" | "deleted" | "unavailable" | "unknown";
  additions: number;
  deletions: number;
  binary?: boolean;
  turnId: string;
  itemId: string;
};

export type ThreadChangeScope = "session" | "lastTurn" | "staged" | "unstaged" | "branch";

export type ThreadResourceKind = "changes" | "attachments";

export type ThreadAttachmentResource = {
  key: string;
  name: string;
  kind: "image" | "audio" | "file";
  path: string | null;
  url: string | null;
  origin: "user" | "agent";
  turnId: string;
  itemId: string;
};

export type ThreadResourcesValue = {
  threadId: string;
  revision: string;
  changeScope: ThreadChangeScope;
  changeScopes: ThreadChangeScope[];
  changes: ThreadChangeResource[];
  attachments: ThreadAttachmentResource[];
};

export type ThreadResourcesRow = {
  id: string;
  connectionId: string;
  threadId: string;
  status: "loading" | "ready" | "error";
  value: ThreadResourcesValue | null;
  error: string | null;
  /** Resource-specific refresh state. Older persisted rows fall back to `status`. */
  pendingKinds?: readonly ThreadResourceKind[];
  readyKinds?: readonly ThreadResourceKind[];
  resourceErrors?: Partial<Record<ThreadResourceKind, string>>;
  updatedAt: number;
};

export type WorkspaceResourceDatabase = {
  threadHistories: ThreadHistoryModel;
  turnControls: LocalCollection<TurnControlsRow>;
  backgroundTerminals: LocalCollection<BackgroundTerminalsRow>;
  threadGoals: LocalCollection<ThreadGoalRow>;
  tunnels: LocalCollection<TunnelRow>;
  voiceInputs: LocalCollection<VoiceInputRow>;
  fileTransfers: LocalCollection<FileTransferRow>;
  threadResources: ThreadResourcesModel;
  putThreadHistory(row: Omit<ThreadHistoryRow, "updatedAt">): void;
  putTurnControls(row: Omit<TurnControlsRow, "updatedAt">): void;
  putBackgroundTerminals(row: Omit<BackgroundTerminalsRow, "updatedAt">): void;
  putThreadGoal(row: Omit<ThreadGoalRow, "updatedAt">): void;
  putTunnel(row: Omit<TunnelRow, "updatedAt">): void;
  putVoiceInput(row: Omit<VoiceInputRow, "updatedAt">): void;
  putFileTransfer(row: Omit<FileTransferRow, "updatedAt">): void;
  putThreadResources(row: Omit<ThreadResourcesRow, "updatedAt">): void;
};

export function createWorkspaceResourceDatabase(): WorkspaceResourceDatabase {
  const threadHistories = createThreadHistoryModel();
  const turnControls = createTurnControlsCollection();
  const backgroundTerminals = createCollection(localOnlyCollectionOptions<BackgroundTerminalsRow, string>({
    id: "workspace-background-terminals-v1",
    getKey: (row) => row.id,
  }));
  const threadGoals = createCollection(localOnlyCollectionOptions<ThreadGoalRow, string>({
    id: "workspace-thread-goals-v1",
    getKey: (row) => row.id,
  }));
  const tunnels = createCollection(localOnlyCollectionOptions<TunnelRow, string>({
    id: "workspace-tunnels-v1",
    getKey: (row) => row.id,
  }));
  const voiceInputs = createCollection(localOnlyCollectionOptions<VoiceInputRow, string>({
    id: "workspace-voice-inputs-v1",
    getKey: (row) => row.id,
  }));
  const fileTransfers = createCollection(localOnlyCollectionOptions<FileTransferRow, string>({
    id: "workspace-file-transfers-v1",
    getKey: (row) => row.id,
  }));
  const threadResources = createThreadResourcesModel();
  return {
    threadHistories,
    turnControls,
    backgroundTerminals,
    threadGoals,
    tunnels,
    voiceInputs,
    fileTransfers,
    threadResources,
    putThreadHistory(row) {
      threadHistories.put(row);
    },
    putTurnControls(row) {
      put(turnControls, { ...row, updatedAt: Date.now() });
      trimOldest(turnControls, 48);
    },
    putBackgroundTerminals(row) {
      put(backgroundTerminals, { ...row, updatedAt: Date.now() });
      trimOldest(backgroundTerminals, 48);
    },
    putThreadGoal(row) {
      put(threadGoals, { ...row, updatedAt: Date.now() });
      trimOldest(threadGoals, 48);
    },
    putTunnel(row) {
      put(tunnels, { ...row, updatedAt: Date.now() });
      trimOldest(tunnels, 24);
    },
    putVoiceInput(row) {
      put(voiceInputs, { ...row, updatedAt: Date.now() });
      trimOldest(voiceInputs, 8);
    },
    putFileTransfer(row) {
      put(fileTransfers, { ...row, updatedAt: Date.now() });
      trimOldest(fileTransfers, 16);
    },
    putThreadResources(row) {
      threadResources.put({ ...row, updatedAt: Date.now() });
    },
  };
}

export function threadHistoryResourceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function turnControlsResourceKey(connectionId: string, cwd: string): string {
  return `${connectionId}\u0000${cwd}`;
}

export function threadResourceKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function tunnelResourceKey(connectionId: string): string {
  return connectionId;
}

type LocalCollection<T extends object> = Collection<T, string>;

function put<T extends { id: string }>(collection: LocalCollection<T>, row: T): void {
  if (collection.has(row.id)) collection.update(row.id, (draft) => Object.assign(draft, row));
  else collection.insert(row);
}

function trimOldest<T extends { id: string; updatedAt: number }>(collection: LocalCollection<T>, max: number): void {
  const rows = collection.toArray;
  const overflow = rows
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(0, Math.max(0, rows.length - max));
  if (overflow.length > 0) collection.delete(overflow.map((row) => row.id));
}
