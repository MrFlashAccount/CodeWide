import { MAX_TURN_TEXT_CHARS } from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { sanitizeHistoryAnchorOffset } from "./thread-history-anchor";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
  ThreadUiStateRow,
} from "./thread-ui-state-types";

export type ThreadUiStateDatabase = {
  collection: Collection<ThreadUiStateRow, string>;
  get(connectionId: string, threadId: string): ThreadUiStateRow | null;
  /** Stable React resource for the persisted composer/anchor row. */
  read(connectionId: string, threadId: string): Promise<ThreadUiStateRow>;
  getOrCreate(connectionId: string, threadId: string): Promise<ThreadUiStateRow>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  saveAttachments(connectionId: string, threadId: string, attachments: StoredDraftAttachment[]): Promise<void>;
  saveScrollOffset(connectionId: string, threadId: string, offset: number, historyAnchorTurnId: string | null, historyAnchorOffsetPx: number | null): Promise<void>;
  savePreferences(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
  close(): void;
};

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  const model = createPersistentCollectionModel<ThreadUiStateRow, string>({
    id: "thread-ui-state-v1",
    tableName: "codewide_thread_ui_state",
    schemaVersion: 1,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    columns: [
      { property: "connectionId", column: "connection_id", type: "TEXT" },
      { property: "threadId", column: "thread_id", type: "TEXT" },
      { property: "updatedAt", column: "updated_at", type: "REAL" },
    ],
    indexes: [["connectionId", "threadId"]],
    legacyCollectionId: "thread-ui-state-v1",
  });
  const { collection } = model;
  const reads = new Map<string, Promise<ThreadUiStateRow>>();

  const get = (connectionId: string, threadId: string): ThreadUiStateRow | null => {
    return collection.get(threadUiStateKey(connectionId, threadId)) ?? null;
  };

  const patch = async (
    connectionId: string,
    threadId: string,
    apply: (draft: ThreadUiStateRow) => void,
  ): Promise<void> => {
    await model.ready;
    const id = threadUiStateKey(connectionId, threadId);
    const current = collection.get(id);
    const transaction = current === undefined
      ? collection.insert(createDefaultRow(id, connectionId, threadId, apply))
      : collection.update(id, (draft) => {
          apply(draft);
          draft.updatedAt = Date.now();
        });
    await transaction.isPersisted.promise;
  };

  const getOrCreate = async (connectionId: string, threadId: string): Promise<ThreadUiStateRow> => {
      await model.ready;
      const existing = get(connectionId, threadId);
      if (existing !== null) return existing;
      const id = threadUiStateKey(connectionId, threadId);
      const row: ThreadUiStateRow = {
        id,
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
      const transaction = collection.insert(row);
      await transaction.isPersisted.promise;
      return row;
  };

  return {
    collection,
    get,
    read(connectionId, threadId) {
      const id = threadUiStateKey(connectionId, threadId);
      let resource = reads.get(id);
      if (resource === undefined) {
        resource = getOrCreate(connectionId, threadId).catch((cause: unknown) => {
          if (reads.get(id) === resource) reads.delete(id);
          throw cause;
        });
        reads.set(id, resource);
      }
      return resource;
    },
    getOrCreate,
    async saveDraft(connectionId, threadId, text) {
      const value = boundedDraft(text);
      await patch(connectionId, threadId, (draft) => { draft.draftText = value; });
    },
    async saveAttachments(connectionId, threadId, attachments) {
      const value = sanitizeDraftAttachments(attachments);
      await patch(connectionId, threadId, (draft) => { draft.attachments = value; });
    },
    async saveScrollOffset(connectionId, threadId, offset, historyAnchorTurnId, historyAnchorOffsetPx) {
      const value = boundedScrollOffset(offset) ?? 0;
      await patch(connectionId, threadId, (draft) => {
        draft.scrollOffset = value;
        draft.historyAnchorTurnId = boundedHistoryAnchor(historyAnchorTurnId);
        draft.historyAnchorOffsetPx = boundedHistoryAnchorOffset(historyAnchorOffsetPx);
      });
    },
    async savePreferences(connectionId, threadId, preferences) {
      const value = clonePreferences(preferences);
      await patch(connectionId, threadId, (draft) => { draft.preferences = value; });
    },
    async deleteConnection(connectionId) {
      await model.ready;
      for (const key of reads.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) reads.delete(key);
      }
      const keys = collection.toArray
        .filter((row) => row.connectionId === connectionId)
        .map((row) => row.id);
      if (keys.length === 0) return;
      const transaction = collection.delete(keys);
      await transaction.isPersisted.promise;
    },
    close() {
      reads.clear();
      model.close();
    },
  };
}

function createDefaultRow(
  id: string,
  connectionId: string,
  threadId: string,
  apply: (draft: ThreadUiStateRow) => void,
): ThreadUiStateRow {
  const row: ThreadUiStateRow = {
    id,
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
  apply(row);
  return row;
}

function boundedDraft(text: string): string {
  if (text.length > MAX_TURN_TEXT_CHARS) throw new Error(`Draft exceeds ${MAX_TURN_TEXT_CHARS} characters`);
  return text;
}

function boundedScrollOffset(offset: number | null): number | null {
  if (offset === null) return null;
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

function boundedHistoryAnchor(turnId: string | null): string | null {
  if (turnId === null) return null;
  return turnId.length > 0 && turnId.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(turnId) ? turnId : null;
}

function boundedHistoryAnchorOffset(offset: number | null): number | null {
  return sanitizeHistoryAnchorOffset(offset);
}

function clonePreferences(preferences: StoredComposerPreferences | null): StoredComposerPreferences | null {
  return preferences === null ? null : {
    ...preferences,
    skillPaths: preferences.skillPaths.slice(0, 256),
  };
}

function sanitizeDraftAttachments(value: unknown): StoredDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const { id, rootId, path, name, kind } = raw as Record<string, unknown>;
    if (
      typeof id !== "string" || id.length < 1 || id.length > 128 ||
      typeof rootId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId) ||
      typeof path !== "string" || path.length < 1 || path.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(path) ||
      typeof name !== "string" || name.length < 1 || name.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(name) ||
      (kind !== "image" && kind !== "audio" && kind !== "file")
    ) return [];
    return [{ id, rootId, path, name, kind }];
  });
}

function threadUiStateKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}
