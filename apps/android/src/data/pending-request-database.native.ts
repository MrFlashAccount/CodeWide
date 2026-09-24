import { appLogger } from "../observability/logger";
import type { PendingRequestDatabase } from "./pending-request-database-contract";

export type { PendingRequestDatabase } from "./pending-request-database-contract";

import { cloneProtocolValue } from "./clone-protocol-value";
import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import type { PendingServerRequest } from "./pending-request-types";

const USER_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
]);

export function createPendingRequestDatabase(): PendingRequestDatabase {
  let disposed = false;
  const model = createPersistentCollectionModel<PendingServerRequest, string>({
    columns: [
      { column: "connection_id", property: "connectionId", type: "TEXT" },
      { column: "request_key", property: "requestKey", type: "TEXT" },
      { column: "created_at", property: "createdAt", type: "REAL" },
    ],
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => rowKey(row.connectionId, row.requestKey),
    id: "pending-server-requests-v1",
    indexes: [["connectionId"]],
    legacyCollectionId: "pending-server-requests-v1",
    schemaVersion: 1,
    tableName: "codewide_pending_requests",
  });
  const { collection, storage } = model;

  const publish = (row: PendingServerRequest): void => {
    if (disposed) {
      return;
    }
    const key = rowKey(row.connectionId, row.requestKey);
    const previous = collection.get(key);
    if (previous !== undefined && sameRequest(previous, row)) {
      return;
    }
    storage.begin();
    storage.write({ type: previous === undefined ? "insert" : "update", value: row });
    void storage.commit().catch((error: unknown) => {
      appLogger.warnCaught({ error: error, event: "pending_request.persist.failed" });
    });
  };

  return {
    claim(connectionId, requestKey) {
      const current = collection.get(rowKey(connectionId, requestKey));
      if (current === undefined || current.state !== "pending") {
        return false;
      }
      publish({ ...current, state: "resolving" });
      return true;
    },
    close() {
      disposed = true;
      model.close();
    },
    collection,
    async deleteConnection(connectionId) {
      await model.ready;
      const keys = collection.toArray
        .filter((row) => row.connectionId === connectionId)
        .map((row) => rowKey(row.connectionId, row.requestKey));
      if (keys.length === 0) {
        return;
      }
      storage.begin();
      for (const key of keys) {
        storage.write({ key, type: "delete" });
      }
      await storage.commit({ durable: true });
    },
    release(connectionId, requestKey) {
      const current = collection.get(rowKey(connectionId, requestKey));
      if (current?.state === "resolving") {
        publish({ ...current, state: "pending" });
      }
    },
    replace(connectionId, requests) {
      if (disposed) {
        return;
      }
      const now = Date.now();
      const incoming = new Map(
        requests.flatMap((request) => {
          if (!USER_SERVER_REQUESTS.has(request.method)) {
            return [];
          }
          const requestKey = remoteRequestKey(request.id);
          const key = rowKey(connectionId, requestKey);
          const previous = collection.get(key);
          const row: PendingServerRequest = {
            connectionId,
            createdAt: previous?.createdAt ?? now,
            method: request.method,
            params: cloneProtocolValue(request.params),
            requestId: request.id,
            requestKey,
            state: previous?.state ?? "pending",
          };
          return [[key, row] as const];
        }),
      );
      storage.begin();
      for (const row of collection.toArray) {
        const key = rowKey(row.connectionId, row.requestKey);
        if (row.connectionId !== connectionId || incoming.has(key)) {
          continue;
        }
        storage.write({ key, type: "delete" });
      }
      for (const [key, row] of incoming) {
        const previous = collection.get(key);
        if (previous !== undefined && sameRequest(previous, row)) {
          continue;
        }
        storage.write({ type: previous === undefined ? "insert" : "update", value: row });
      }
      void storage.commit().catch((error: unknown) => {
        appLogger.warnCaught({ error: error, event: "pending_request.reconcile.failed" });
      });
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
  return (
    left.connectionId === right.connectionId &&
    left.requestKey === right.requestKey &&
    left.requestId === right.requestId &&
    left.method === right.method &&
    left.state === right.state &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.params) === JSON.stringify(right.params)
  );
}
