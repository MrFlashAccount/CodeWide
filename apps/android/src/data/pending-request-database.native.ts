import type { SyncServerRequest } from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import type { PendingServerRequest } from "./pending-request-types";

export type PendingRequestDatabase = {
  collection: Collection<PendingServerRequest, string>;
  replace(connectionId: string, requests: SyncServerRequest[]): void;
  claim(connectionId: string, requestKey: string): boolean;
  release(connectionId: string, requestKey: string): void;
  close(): void;
};

const USER_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
]);

export function createPendingRequestDatabase(): PendingRequestDatabase {
  let source = new Map<string, PendingServerRequest>();
  let disposed = false;
  const model = createPersistentCollectionModel<PendingServerRequest, string>({
    id: "pending-server-requests-v1",
    tableName: "codewide_pending_requests",
    schemaVersion: 1,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => rowKey(row.connectionId, row.requestKey),
    columns: [
      { property: "connectionId", column: "connection_id", type: "TEXT" },
      { property: "requestKey", column: "request_key", type: "TEXT" },
      { property: "createdAt", column: "created_at", type: "REAL" },
    ],
    indexes: [["connectionId"]],
    legacyCollectionId: "pending-server-requests-v1",
    onResidentRows: (rows) => { source = new Map(rows.map((row) => [rowKey(row.connectionId, row.requestKey), row])); },
  });
  const { collection, storage } = model;

  const publish = (row: PendingServerRequest): void => {
    if (disposed) return;
    const key = rowKey(row.connectionId, row.requestKey);
    const previous = source.get(key);
    if (previous !== undefined && sameRequest(previous, row)) return;
    source.set(key, row);
    storage.begin();
    storage.write({ type: previous === undefined ? "insert" : "update", value: row });
    void storage.commit().catch((cause: unknown) => console.warn("Could not persist pending request", cause));
  };

  return {
    collection,
    replace(connectionId, requests) {
      if (disposed) return;
      const now = Date.now();
      const incoming = new Map(requests.flatMap((request) => {
        if (!USER_SERVER_REQUESTS.has(request.method)) return [];
        const requestKey = remoteRequestKey(request.id);
        const key = rowKey(connectionId, requestKey);
        const previous = source.get(key);
        const row: PendingServerRequest = {
          connectionId,
          requestKey,
          requestId: request.id,
          method: request.method,
          params: structuredClone(request.params),
          state: previous?.state ?? "pending",
          createdAt: previous?.createdAt ?? now,
        };
        return [[key, row] as const];
      }));
      storage.begin();
      for (const [key, row] of source) {
        if (row.connectionId !== connectionId || incoming.has(key)) continue;
        source.delete(key);
        storage.write({ type: "delete", key });
      }
      for (const [key, row] of incoming) {
        const previous = source.get(key);
        if (previous !== undefined && sameRequest(previous, row)) continue;
        source.set(key, row);
        storage.write({ type: previous === undefined ? "insert" : "update", value: row });
      }
      void storage.commit().catch((cause: unknown) => console.warn("Could not reconcile pending requests", cause));
    },
    claim(connectionId, requestKey) {
      const current = source.get(rowKey(connectionId, requestKey));
      if (current === undefined || current.state !== "pending") return false;
      publish({ ...current, state: "resolving" });
      return true;
    },
    release(connectionId, requestKey) {
      const current = source.get(rowKey(connectionId, requestKey));
      if (current?.state === "resolving") publish({ ...current, state: "pending" });
    },
    close() {
      disposed = true;
      model.close();
    },
  };
}

function rowKey(connectionId: string, requestKey: string): string {
  return `${connectionId}\u0000${requestKey}`;
}

function remoteRequestKey(id: string | number): string {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function sameRequest(left: PendingServerRequest, right: PendingServerRequest): boolean {
  return left.connectionId === right.connectionId
    && left.requestKey === right.requestKey
    && left.requestId === right.requestId
    && left.method === right.method
    && left.state === right.state
    && left.createdAt === right.createdAt
    && JSON.stringify(left.params) === JSON.stringify(right.params);
}
