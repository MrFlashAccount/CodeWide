import type { ThreadResourcesRow } from "./thread-resource-types";

export type {
  ThreadChangeResource,
  ThreadChangeScope,
  ThreadResourceKind,
  ThreadAttachmentResource,
  ThreadResourcesValue,
  ThreadResourcesRow,
} from "./thread-resource-types";
import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection, type Collection } from "@tanstack/react-db";
import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

import { createTurnControlsCollection } from "./turn-controls-collection";
import {
  createThreadHistoryModel,
  type ThreadHistoryModel,
  type ThreadHistoryRow,
} from "./thread-history-model";
import type { TurnControlsRow } from "./turn-controls-types";
import { createThreadResourcesModel, type ThreadResourcesModel } from "./thread-resources-model";

export type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";

export type BackgroundTerminalValue = {
  command: string;
  cpuPercent: number | null;
  cwd: string;
  itemId: string;
  osPid: number | null;
  processId: string;
  rssKb: string | null;
};

export type BackgroundTerminalsRow = {
  connectionId: string;
  error: string | null;
  id: string;
  items: BackgroundTerminalValue[];
  status: "loading" | "ready" | "error";
  threadId: string;
  updatedAt: number;
};

export type ThreadGoalRow = {
  connectionId: string;
  error: string | null;
  goal: ThreadGoal | null;
  id: string;
  status: "loading" | "ready" | "error";
  threadId: string;
  updatedAt: number;
};

export type TunnelValue = { authorization: string; expiresAt: number; id: string; url: string };

export type TunnelRow = {
  connectionId: string;
  error: string | null;
  id: string;
  status: "creating" | "ready" | "revoking" | "error";
  tunnel: TunnelValue | null;
  updatedAt: number;
};

export type VoiceInputRow = {
  backend: "remote" | "android";
  error: string | null;
  id: string;
  level: number;
  pendingSelection: { end: number; start: number } | null;
  phase: "idle" | "starting" | "recording" | "finishing";
  retryAvailable: boolean;
  scope: string;
  seconds: number;
  updatedAt: number;
};

type FileTransferRow = {
  error: string | null;
  id: string;
  progress: {
    phase: "hashing" | "transferring" | "verifying";
    total: number;
    transferred: number;
  } | null;
  result: string | null;
  scope: string;
  status: "idle" | "authorizing" | "running" | "complete" | "error";
  updatedAt: number;
};

export type WorkspaceResourceDatabase = {
  backgroundTerminals: LocalCollection<BackgroundTerminalsRow>;
  deleteConnection: (connectionId: string) => Promise<void>;
  fileTransfers: LocalCollection<FileTransferRow>;
  putBackgroundTerminals: (row: Omit<BackgroundTerminalsRow, "updatedAt">) => void;
  putFileTransfer: (row: Omit<FileTransferRow, "updatedAt">) => void;
  putThreadGoal: (row: Omit<ThreadGoalRow, "updatedAt">) => void;
  putThreadHistory: (row: Omit<ThreadHistoryRow, "updatedAt">) => void;
  putThreadResources: (row: Omit<ThreadResourcesRow, "updatedAt">) => void;
  putTunnel: (row: Omit<TunnelRow, "updatedAt">) => void;
  putTurnControls: (row: Omit<TurnControlsRow, "updatedAt">) => void;
  putVoiceInput: (row: Omit<VoiceInputRow, "updatedAt">) => void;
  threadGoals: LocalCollection<ThreadGoalRow>;
  threadHistories: ThreadHistoryModel;
  threadResources: ThreadResourcesModel;
  tunnels: LocalCollection<TunnelRow>;
  turnControls: LocalCollection<TurnControlsRow>;
  voiceInputs: LocalCollection<VoiceInputRow>;
};

export function createWorkspaceResourceDatabase(): WorkspaceResourceDatabase {
  const deletedConnections = new Set<string>();
  const isDeleted = (id: string): boolean => {
    const separator = id.indexOf("\u0000");
    return deletedConnections.has(separator === -1 ? id : id.slice(0, separator));
  };
  const threadHistories = createThreadHistoryModel();
  const turnControls = createTurnControlsCollection();
  const backgroundTerminals = createCollection(
    localOnlyCollectionOptions<BackgroundTerminalsRow, string>({
      getKey: (row) => row.id,
      id: "workspace-background-terminals-v1",
    }),
  );
  const threadGoals = createCollection(
    localOnlyCollectionOptions<ThreadGoalRow, string>({
      getKey: (row) => row.id,
      id: "workspace-thread-goals-v1",
    }),
  );
  const tunnels = createCollection(
    localOnlyCollectionOptions<TunnelRow, string>({
      getKey: (row) => row.id,
      id: "workspace-tunnels-v1",
    }),
  );
  const voiceInputs = createCollection(
    localOnlyCollectionOptions<VoiceInputRow, string>({
      getKey: (row) => row.id,
      id: "workspace-voice-inputs-v1",
    }),
  );
  const fileTransfers = createCollection(
    localOnlyCollectionOptions<FileTransferRow, string>({
      getKey: (row) => row.id,
      id: "workspace-file-transfers-v1",
    }),
  );
  const threadResources = createThreadResourcesModel();
  return {
    backgroundTerminals,
    async deleteConnection(connectionId) {
      deletedConnections.add(connectionId);
      const prefix = `${connectionId}\u0000`;
      for (const collection of [
        backgroundTerminals,
        threadGoals,
        tunnels,
        voiceInputs,
        fileTransfers,
      ]) {
        const keys = collection.toArray
          .filter((row) => row.id === connectionId || row.id.startsWith(prefix))
          .map((row) => row.id);
        if (keys.length > 0) {
          await collection.delete(keys).isPersisted.promise;
        }
      }
      const controlKeys = turnControls.toArray
        .filter((row) => row.id.startsWith(prefix))
        .map((row) => row.id);
      if (controlKeys.length > 0) {
        await turnControls.delete(controlKeys).isPersisted.promise;
      }
      threadHistories.forgetConnection(connectionId);
      threadResources.forgetConnection(connectionId);
    },
    fileTransfers,
    putBackgroundTerminals(row) {
      if (deletedConnections.has(row.connectionId)) {
        return;
      }
      put(backgroundTerminals, { ...row, updatedAt: Date.now() });
      trimOldest(backgroundTerminals, 48);
    },
    putFileTransfer(row) {
      if (isDeleted(row.id)) {
        return;
      }
      put(fileTransfers, { ...row, updatedAt: Date.now() });
      trimOldest(fileTransfers, 16);
    },
    putThreadGoal(row) {
      if (deletedConnections.has(row.connectionId)) {
        return;
      }
      put(threadGoals, { ...row, updatedAt: Date.now() });
      trimOldest(threadGoals, 48);
    },
    putThreadHistory(row) {
      if (deletedConnections.has(row.connectionId)) {
        return;
      }
      threadHistories.put(row);
    },
    putThreadResources(row) {
      if (deletedConnections.has(row.connectionId)) {
        return;
      }
      threadResources.put({ ...row, updatedAt: Date.now() });
    },
    putTunnel(row) {
      if (deletedConnections.has(row.connectionId)) {
        return;
      }
      put(tunnels, { ...row, updatedAt: Date.now() });
      trimOldest(tunnels, 24);
    },
    putTurnControls(row) {
      if (isDeleted(row.id)) {
        return;
      }
      put(turnControls, { ...row, updatedAt: Date.now() });
      trimOldest(turnControls, 48);
    },
    putVoiceInput(row) {
      if (isDeleted(row.id)) {
        return;
      }
      put(voiceInputs, { ...row, updatedAt: Date.now() });
      trimOldest(voiceInputs, 8);
    },
    threadGoals,
    threadHistories,
    threadResources,
    tunnels,
    turnControls,
    voiceInputs,
  };
}

type LocalCollection<T extends Record<string, unknown>> = Collection<T, string>;

function put<T extends { id: string }>(collection: LocalCollection<T>, row: T): void {
  if (collection.has(row.id)) {
    collection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
  } else {
    collection.insert(row);
  }
}

function trimOldest<T extends { id: string; updatedAt: number }>(
  collection: LocalCollection<T>,
  max: number,
): void {
  const rows = collection.toArray;
  const overflow = rows
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(0, Math.max(0, rows.length - max));
  if (overflow.length > 0) {
    collection.delete(overflow.map((row) => row.id));
  }
}

export type ThreadGoalInput = {
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget?: number | null;
};
