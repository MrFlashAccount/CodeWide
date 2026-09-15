import type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";

export type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";
import { MAX_TURN_TEXT_CHARS } from "@codewide/sync-client";
import { observable, type Observable } from "@legendapp/state";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { sanitizeHistoryAnchorOffset } from "./thread-history-anchor";
import type {
  QuickdrawDraftState,
  AttachmentPreview,
  StoredComposerPreferences,
  StoredDraftAttachment,
  ThreadUiStateRow,
} from "./thread-ui-state-types";

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
  const rows = new Map<string, Observable<ThreadUiStateRow | null>>();

  const get = (connectionId: string, threadId: string): ThreadUiStateRow | null => {
    return collection.get(threadUiStateKey(connectionId, threadId)) ?? null;
  };

  const publishRow = (id: string): void => {
    rows.get(id)?.set(collection.get(id) ?? null);
  };

  const row$ = (connectionId: string, threadId: string): Observable<ThreadUiStateRow | null> => {
    const id = threadUiStateKey(connectionId, threadId);
    const existing = rows.get(id);
    if (existing !== undefined) return existing;
    const created = observable<ThreadUiStateRow | null>(collection.get(id) ?? null);
    rows.set(id, created);
    return created;
  };

  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) publishRow(String(change.key));
    },
    { includeInitialState: false },
  );

  const patch = async (
    connectionId: string,
    threadId: string,
    apply: (draft: ThreadUiStateRow) => void,
  ): Promise<void> => {
    await model.ready;
    const id = threadUiStateKey(connectionId, threadId);
    const current = collection.get(id);
    const transaction =
      current === undefined
        ? collection.insert(createDefaultRow(id, connectionId, threadId, apply))
        : collection.update(id, (draft) => {
            apply(draft);
            draft.updatedAt = Date.now();
          });
    await transaction.isPersisted.promise;
    publishRow(id);
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
    publishRow(id);
    return row;
  };

  return {
    collection,
    get,
    row$,
    read(connectionId, threadId) {
      const id = threadUiStateKey(connectionId, threadId);
      let resource = reads.get(id);
      if (resource === undefined) {
        resource = getOrCreate(connectionId, threadId)
          .then((row) => {
            row$(connectionId, threadId).set(row);
            return row;
          })
          .catch((cause: unknown) => {
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
      await patch(connectionId, threadId, (draft) => {
        draft.draftText = value;
      });
    },
    async saveAttachments(connectionId, threadId, attachments) {
      const value = sanitizeDraftAttachments(attachments);
      await patch(connectionId, threadId, (draft) => {
        draft.attachments = value;
      });
    },
    async upsertAttachment(connectionId, threadId, attachment, isCurrent) {
      const value = sanitizeDraftAttachments([attachment])[0];
      if (value === undefined) throw new Error("Invalid draft attachment");
      await patch(connectionId, threadId, (draft) => {
        if (!isCurrent()) return;
        const index = draft.attachments.findIndex((item) => item.id === value.id);
        if (index < 0) draft.attachments.push(value);
        else draft.attachments[index] = value;
      });
    },
    async removeAttachment(connectionId, threadId, attachmentId) {
      await patch(connectionId, threadId, (draft) => {
        draft.attachments = draft.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        );
      });
    },
    async saveScrollOffset(
      connectionId,
      threadId,
      offset,
      historyAnchorTurnId,
      historyAnchorOffsetPx,
    ) {
      const value = boundedScrollOffset(offset) ?? 0;
      await patch(connectionId, threadId, (draft) => {
        draft.scrollOffset = value;
        draft.historyAnchorTurnId = boundedHistoryAnchor(historyAnchorTurnId);
        draft.historyAnchorOffsetPx = boundedHistoryAnchorOffset(historyAnchorOffsetPx);
      });
    },
    async savePreferences(connectionId, threadId, preferences) {
      const value = clonePreferences(preferences);
      await patch(connectionId, threadId, (draft) => {
        draft.preferences = value;
      });
    },
    async deleteConnection(connectionId) {
      await model.ready;
      for (const key of reads.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) reads.delete(key);
      }
      for (const [key, row] of rows) {
        if (!key.startsWith(`${connectionId}\u0000`)) continue;
        row.set(null);
        rows.delete(key);
      }
      const keys = collection.toArray
        .filter((row) => row.connectionId === connectionId)
        .map((row) => row.id);
      if (keys.length === 0) return;
      const transaction = collection.delete(keys);
      await transaction.isPersisted.promise;
    },
    close() {
      subscription.unsubscribe();
      reads.clear();
      rows.clear();
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
  if (text.length > MAX_TURN_TEXT_CHARS)
    throw new Error(`Draft exceeds ${MAX_TURN_TEXT_CHARS} characters`);
  return text;
}

function boundedScrollOffset(offset: number | null): number | null {
  if (offset === null) return null;
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

function boundedHistoryAnchor(turnId: string | null): string | null {
  if (turnId === null) return null;
  return turnId.length > 0 && turnId.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(turnId)
    ? turnId
    : null;
}

function boundedHistoryAnchorOffset(offset: number | null): number | null {
  return sanitizeHistoryAnchorOffset(offset);
}

function clonePreferences(
  preferences: StoredComposerPreferences | null,
): StoredComposerPreferences | null {
  return preferences === null
    ? null
    : {
        ...preferences,
        skillPaths: preferences.skillPaths.slice(0, 256),
      };
}

function sanitizeDraftAttachments(value: unknown): StoredDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const { id, rootId, path, name, kind, editor, preview } = raw as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      id.length < 1 ||
      id.length > 128 ||
      typeof rootId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId) ||
      typeof path !== "string" ||
      path.length < 1 ||
      path.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(name) ||
      (kind !== "image" && kind !== "audio" && kind !== "file")
    )
      return [];
    const quickdrawEditor = sanitizeQuickdrawEditor(editor);
    const localPreview = sanitizeAttachmentPreview(preview);
    return [
      {
        id,
        rootId,
        path,
        name,
        kind,
        ...(quickdrawEditor === null ? {} : { editor: quickdrawEditor }),
        ...(localPreview === null ? {} : { preview: localPreview }),
      },
    ];
  });
}

function sanitizeAttachmentPreview(value: unknown): AttachmentPreview | null {
  if (
    value === null ||
    typeof value !== "object" ||
    !("uri" in value) ||
    !("text" in value) ||
    !("bytes" in value) ||
    !("mimeType" in value)
  )
    return null;
  const { uri, text, bytes, mimeType } = value;
  if (
    uri !== null &&
    (typeof uri !== "string" || uri.length > 4096 || !/^(?:file|content):\/\//u.test(uri))
  )
    return null;
  if (text !== null && (typeof text !== "string" || text.length > 512)) return null;
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof mimeType !== "string" ||
    mimeType.length > 256
  )
    return null;
  return { uri, text, bytes, mimeType };
}

function sanitizeQuickdrawEditor(value: unknown): QuickdrawDraftState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { kind, mode, snapshot, revision } = value as Record<string, unknown>;
  if (
    kind !== "quickdraw" ||
    (mode !== "drawing" && mode !== "image-annotation") ||
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return null;
  return { kind, mode, snapshot: snapshot as Record<string, unknown>, revision };
}

function threadUiStateKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}
