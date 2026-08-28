import type { ThreadUiStateDatabase } from "./thread-ui-state-database.native";
import { observable, type Observable } from "@legendapp/state";
import type { ThreadUiStateRow } from "./thread-ui-state-types";

export type { ThreadUiStateDatabase } from "./thread-ui-state-database.native";

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  const reads = new Map<string, Promise<Awaited<ReturnType<ThreadUiStateDatabase["getOrCreate"]>>>>();
  const rows = new Map<string, Observable<ThreadUiStateRow | null>>();
  return {
    collection: null as never,
    get() { return null; },
    row$(connectionId, threadId) {
      const key = `${connectionId}\u0000${threadId}`;
      const existing = rows.get(key);
      if (existing !== undefined) return existing;
      const created = observable<ThreadUiStateRow | null>(null);
      rows.set(key, created);
      return created;
    },
    read(connectionId, threadId) {
      const key = `${connectionId}\u0000${threadId}`;
      const existing = reads.get(key);
      if (existing !== undefined) return existing;
      const pending = this.getOrCreate(connectionId, threadId);
      reads.set(key, pending);
      void pending.then((row) => this.row$(connectionId, threadId).set(row)).catch(() => {
        if (reads.get(key) === pending) reads.delete(key);
      });
      return pending;
    },
    async getOrCreate(connectionId, threadId) {
      return {
        id: `${connectionId}\u0000${threadId}`,
        connectionId,
        threadId,
        draftText: "",
        attachments: [],
        scrollOffset: null,
        historyAnchorTurnId: null,
        historyAnchorOffsetPx: null,
        preferences: null,
        updatedAt: Date.now(),
      };
    },
    async saveDraft() {},
    async saveAttachments() {},
    async saveScrollOffset() {},
    async savePreferences() {},
    async deleteConnection(connectionId) {
      for (const key of reads.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) reads.delete(key);
      }
      for (const key of rows.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) rows.delete(key);
      }
    },
    close() { reads.clear(); rows.clear(); },
  };
}
