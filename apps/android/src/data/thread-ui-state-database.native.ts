import { MAX_TURN_TEXT_CHARS } from "@codewide/sync-client";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { getUiCachePersistence } from "./ui-cache-persistence.native";
import type {
  LegacyThreadUiState,
  StoredComposerPreferences,
  StoredDraftAttachment,
  ThreadUiStateRow,
} from "./thread-ui-state-types";

export type ThreadUiStateDatabase = {
  collection: Collection<ThreadUiStateRow, string>;
  get(connectionId: string, threadId: string): ThreadUiStateRow | null;
  seedLegacy(connectionId: string, threadId: string, state: LegacyThreadUiState): Promise<ThreadUiStateRow>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  saveAttachments(connectionId: string, threadId: string, attachments: StoredDraftAttachment[]): Promise<void>;
  saveScrollOffset(connectionId: string, threadId: string, offset: number): Promise<void>;
  savePreferences(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
  close(): void;
};

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  const collection = createCollection(
    persistedCollectionOptions<ThreadUiStateRow, string>({
      id: "thread-ui-state-v1",
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getUiCachePersistence(),
    }),
  );

  const get = (connectionId: string, threadId: string): ThreadUiStateRow | null => {
    return collection.get(threadUiStateKey(connectionId, threadId)) ?? null;
  };

  const patch = async (
    connectionId: string,
    threadId: string,
    apply: (draft: ThreadUiStateRow) => void,
  ): Promise<void> => {
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

  return {
    collection,
    get,
    async seedLegacy(connectionId, threadId, state) {
      const existing = get(connectionId, threadId);
      if (existing !== null) return existing;
      const id = threadUiStateKey(connectionId, threadId);
      const row: ThreadUiStateRow = {
        id,
        connectionId,
        threadId,
        draftText: boundedDraft(state.draftText),
        attachments: sanitizeDraftAttachments(state.attachments),
        scrollOffset: boundedScrollOffset(state.scrollOffset),
        preferences: clonePreferences(state.preferences),
        migratedFromLegacy: true,
        updatedAt: Date.now(),
      };
      const transaction = collection.insert(row);
      await transaction.isPersisted.promise;
      return row;
    },
    async saveDraft(connectionId, threadId, text) {
      const value = boundedDraft(text);
      await patch(connectionId, threadId, (draft) => { draft.draftText = value; });
    },
    async saveAttachments(connectionId, threadId, attachments) {
      const value = sanitizeDraftAttachments(attachments);
      await patch(connectionId, threadId, (draft) => { draft.attachments = value; });
    },
    async saveScrollOffset(connectionId, threadId, offset) {
      const value = boundedScrollOffset(offset) ?? 0;
      await patch(connectionId, threadId, (draft) => { draft.scrollOffset = value; });
    },
    async savePreferences(connectionId, threadId, preferences) {
      const value = clonePreferences(preferences);
      await patch(connectionId, threadId, (draft) => { draft.preferences = value; });
    },
    async deleteConnection(connectionId) {
      const keys = collection.toArray
        .filter((row) => row.connectionId === connectionId)
        .map((row) => row.id);
      if (keys.length === 0) return;
      const transaction = collection.delete(keys);
      await transaction.isPersisted.promise;
    },
    close() {
      collection.cleanup();
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
    preferences: null,
    migratedFromLegacy: true,
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
