import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection, type Collection } from "@tanstack/react-db";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";

import { createTurnControlsCollection } from "./turn-controls-collection";
import type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";

export type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";

export type ThreadLoadState = {
  phase: "loading" | "refreshing" | "ready" | "error";
  nextCursor: string | null;
  loadingOlder: boolean;
  residentOffset: number;
  error: string | null;
};

export type ThreadLoadRow = ThreadLoadState & {
  id: string;
  connectionId: string;
  threadId: string;
  generation: number;
  updatedAt: number;
};

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
  turnId: string;
  itemId: string;
};

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
  updatedAt: number;
};

export type WorkspaceResourceDatabase = {
  threadLoads: LocalCollection<ThreadLoadRow>;
  turnControls: LocalCollection<TurnControlsRow>;
  backgroundTerminals: LocalCollection<BackgroundTerminalsRow>;
  threadGoals: LocalCollection<ThreadGoalRow>;
  tunnels: LocalCollection<TunnelRow>;
  voiceInputs: LocalCollection<VoiceInputRow>;
  fileTransfers: LocalCollection<FileTransferRow>;
  threadResources: LocalCollection<ThreadResourcesRow>;
  putThreadLoad(row: Omit<ThreadLoadRow, "updatedAt">): void;
  putTurnControls(row: Omit<TurnControlsRow, "updatedAt">): void;
  putBackgroundTerminals(row: Omit<BackgroundTerminalsRow, "updatedAt">): void;
  putThreadGoal(row: Omit<ThreadGoalRow, "updatedAt">): void;
  putTunnel(row: Omit<TunnelRow, "updatedAt">): void;
  putVoiceInput(row: Omit<VoiceInputRow, "updatedAt">): void;
  putFileTransfer(row: Omit<FileTransferRow, "updatedAt">): void;
  putThreadResources(row: Omit<ThreadResourcesRow, "updatedAt">): void;
};

export function createWorkspaceResourceDatabase(): WorkspaceResourceDatabase {
  const threadLoads = createCollection(localOnlyCollectionOptions<ThreadLoadRow, string>({
    id: "workspace-thread-loads-v1",
    getKey: (row) => row.id,
  }));
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
  const threadResources = createCollection(localOnlyCollectionOptions<ThreadResourcesRow, string>({
    id: "workspace-thread-resources-v1",
    getKey: (row) => row.id,
  }));
  return {
    threadLoads,
    turnControls,
    backgroundTerminals,
    threadGoals,
    tunnels,
    voiceInputs,
    fileTransfers,
    threadResources,
    putThreadLoad(row) {
      put(threadLoads, { ...row, updatedAt: Date.now() });
      trimOldest(threadLoads, 72);
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
      put(threadResources, { ...row, updatedAt: Date.now() });
      trimOldest(threadResources, 48);
    },
  };
}

export function threadLoadResourceKey(connectionId: string, threadId: string, generation: number): string {
  return `${connectionId}\u0000${threadId}\u0000${generation}`;
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
