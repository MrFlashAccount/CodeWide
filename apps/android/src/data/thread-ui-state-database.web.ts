import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection } from "@tanstack/react-db";
import type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";
import { observable, type Observable } from "@legendapp/state";
import type { ThreadUiStateRow } from "./thread-ui-state-types";

export type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  const reads = new Map<
    string,
    Promise<Awaited<ReturnType<ThreadUiStateDatabase["getOrCreate"]>>>
  >();
  const rows = new Map<string, Observable<ThreadUiStateRow | null>>();
  const retainCounts = new Map<string, number>();
  const collection = createCollection(
    localOnlyCollectionOptions<ThreadUiStateRow, string>({
      getKey: (row) => row.id,
      id: "thread-ui-state-web",
    }),
  );
  const ready = collection.preload();
  return {
    close() {
      reads.clear();
      retainCounts.clear();
      rows.clear();
      collection.cleanup().catch(() => undefined);
    },
    async deleteConnection(connectionId) {
      await Promise.resolve();
      for (const key of reads.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) {
          reads.delete(key);
        }
      }
      for (const key of rows.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) {
          rows.delete(key);
        }
      }
      for (const key of retainCounts.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) {
          retainCounts.delete(key);
        }
      }
      return;
    },
    async deleteThread(connectionId, threadId) {
      await Promise.resolve();
      const key = `${connectionId}\u0000${threadId}`;
      reads.delete(key);
      retainCounts.delete(key);
      rows.delete(key);
    },
    get() {
      return null;
    },
    async getOrCreate(connectionId, threadId) {
      await Promise.resolve();
      return {
        attachments: [],
        connectionId,
        draftText: "",
        historyAnchorOffsetPx: null,
        historyAnchorTurnId: null,
        id: `${connectionId}\u0000${threadId}`,
        preferences: null,
        scrollOffset: null,
        threadId,
        updatedAt: Date.now(),
      };
    },
    // WHY: React.use requires the cached Promise itself; async would wrap it on every call.
    // oxlint-disable-next-line typescript/promise-function-async
    read(connectionId, threadId) {
      const key = `${connectionId}\u0000${threadId}`;
      const existing = reads.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const pending = this.getOrCreate(connectionId, threadId);
      reads.set(key, pending);
      void pending
        .then((row) => this.row$(connectionId, threadId).set(row))
        .catch(() => {
          if (reads.get(key) === pending) {
            reads.delete(key);
          }
        });
      return pending;
    },
    ready,
    async removeAttachment() {
      await Promise.resolve();
      return;
    },
    retain(connectionId, threadId) {
      const key = `${connectionId}\u0000${threadId}`;
      retainCounts.set(key, (retainCounts.get(key) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) {
          return;
        }
        retained = false;
        const next = (retainCounts.get(key) ?? 1) - 1;
        if (next > 0) {
          retainCounts.set(key, next);
          return;
        }
        retainCounts.delete(key);
        reads.delete(key);
        rows.delete(key);
      };
    },
    row$(connectionId, threadId) {
      const key = `${connectionId}\u0000${threadId}`;
      const existing = rows.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = observable<ThreadUiStateRow | null>(null);
      rows.set(key, created);
      return created;
    },
    async saveAttachments() {
      await Promise.resolve();
      return;
    },
    async saveDraft() {
      await Promise.resolve();
      return;
    },
    async savePreferences() {
      await Promise.resolve();
      return;
    },
    async saveScrollOffset() {
      await Promise.resolve();
      return;
    },
    async upsertAttachment() {
      await Promise.resolve();
      return;
    },
  };
}
