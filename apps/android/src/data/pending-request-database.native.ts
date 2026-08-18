import type { SyncServerRequest } from "@codewide/sync-client";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { getUiCachePersistence } from "./ui-cache-persistence.native";
import type { PendingServerRequest } from "./pending-request-types";

export type PendingRequestDatabase = {
  collection: Collection<PendingServerRequest, string>;
  replace(connectionId: string, requests: SyncServerRequest[]): void;
  claim(connectionId: string, requestKey: string): boolean;
  release(connectionId: string, requestKey: string): void;
  close(): void;
};

type SyncControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change:
    | { type: "insert" | "update"; value: PendingServerRequest }
    | { type: "delete"; key: string }
  ): void;
  commit(): void;
};

const USER_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
]);

export function createPendingRequestDatabase(): PendingRequestDatabase {
  let controls: SyncControls | null = null;
  let source = new Map<string, PendingServerRequest>();
  let bootstrapped = false;
  let disposed = false;
  const collection = createCollection(
    persistedCollectionOptions<PendingServerRequest, string>({
      id: "pending-server-requests-v1",
      schemaVersion: 1,
      getKey: (row) => rowKey(row.connectionId, row.requestKey),
      persistence: getUiCachePersistence(),
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          controls = { begin, write, commit };
          markReady();
          return { cleanup: () => { controls = null; } };
        },
      },
    }),
  );

  const bootstrap = (): void => {
    if (bootstrapped) return;
    source = new Map(collection.toArray.map((row) => [rowKey(row.connectionId, row.requestKey), row]));
    bootstrapped = true;
  };

  const publish = (row: PendingServerRequest): void => {
    if (disposed || controls === null) return;
    bootstrap();
    const key = rowKey(row.connectionId, row.requestKey);
    const previous = source.get(key);
    if (previous !== undefined && sameRequest(previous, row)) return;
    source.set(key, row);
    controls.begin({ immediate: true });
    controls.write({ type: previous === undefined ? "insert" : "update", value: row });
    controls.commit();
  };

  return {
    collection,
    replace(connectionId, requests) {
      if (disposed || controls === null) return;
      bootstrap();
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
      controls.begin({ immediate: true });
      for (const [key, row] of source) {
        if (row.connectionId !== connectionId || incoming.has(key)) continue;
        source.delete(key);
        controls.write({ type: "delete", key });
      }
      for (const [key, row] of incoming) {
        const previous = source.get(key);
        if (previous !== undefined && sameRequest(previous, row)) continue;
        source.set(key, row);
        controls.write({ type: previous === undefined ? "insert" : "update", value: row });
      }
      controls.commit();
    },
    claim(connectionId, requestKey) {
      bootstrap();
      const current = source.get(rowKey(connectionId, requestKey));
      if (current === undefined || current.state !== "pending") return false;
      publish({ ...current, state: "resolving" });
      return true;
    },
    release(connectionId, requestKey) {
      bootstrap();
      const current = source.get(rowKey(connectionId, requestKey));
      if (current?.state === "resolving") publish({ ...current, state: "pending" });
    },
    close() {
      disposed = true;
      collection.cleanup();
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
