import type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";
import { unknownRecord } from "./unknownRecord";

export type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";
import { MAX_TURN_TEXT_CHARS } from "@codewide/sync-client";
import { observable, type Observable } from "@legendapp/state";
import { IR, type LoadSubsetOptions } from "@tanstack/db";

import { createOnDemandPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { sanitizeHistoryAnchorOffset } from "./thread-history-anchor";
import type {
  QuickdrawDraftState,
  AttachmentPreview,
  StoredComposerPreferences,
  StoredDraftAttachment,
  ThreadUiStateRow,
} from "./thread-ui-state-types";

const UNRETAINED_RESOURCE_TTL_MS = 30_000;

type ResidentThreadUiState = {
  loading: Promise<void>;
  options: LoadSubsetOptions;
};

export function createThreadUiStateDatabase(): ThreadUiStateDatabase {
  const model = createOnDemandPersistentCollectionModel<ThreadUiStateRow, string>({
    columns: [
      { column: "connection_id", property: "connectionId", type: "TEXT" },
      { column: "thread_id", property: "threadId", type: "TEXT" },
      { column: "updated_at", property: "updatedAt", type: "REAL" },
    ],
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    id: "thread-ui-state-v1",
    indexes: [["connectionId", "threadId"]],
    legacyCollectionId: "thread-ui-state-v1",
    schemaVersion: 1,
    tableName: "codewide_thread_ui_state",
  });
  const { collection } = model;
  const activeUses = new Map<string, number>();
  const releasePending = new Set<string>();
  const reads = new Map<string, Promise<ThreadUiStateRow>>();
  const residents = new Map<string, ResidentThreadUiState>();
  const retainCounts = new Map<string, number>();
  const rows = new Map<string, Observable<ThreadUiStateRow | null>>();
  const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelEviction = (id: string): void => {
    const timer = evictionTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      evictionTimers.delete(id);
    }
  };

  const evictKey = (id: string): void => {
    cancelEviction(id);
    reads.delete(id);
    rows.delete(id);
    const resident = residents.get(id);
    if (resident !== undefined) {
      residents.delete(id);
      collection._sync.unloadSubset(resident.options);
    }
  };

  const scheduleUnretainedEviction = (id: string): void => {
    if ((retainCounts.get(id) ?? 0) > 0) {
      return;
    }
    cancelEviction(id);
    evictionTimers.set(
      id,
      setTimeout(() => {
        evictionTimers.delete(id);
        if ((retainCounts.get(id) ?? 0) === 0) {
          evictKey(id);
        }
      }, UNRETAINED_RESOURCE_TTL_MS),
    );
  };

  const invalidateKey = (id: string): void => {
    retainCounts.delete(id);
    cancelEviction(id);
    reads.delete(id);
    rows.get(id)?.set(null);
    rows.delete(id);
    if ((activeUses.get(id) ?? 0) > 0) {
      releasePending.add(id);
      return;
    }
    releasePending.delete(id);
    evictKey(id);
  };

  const finishUse = (id: string): void => {
    const next = (activeUses.get(id) ?? 1) - 1;
    if (next > 0) {
      activeUses.set(id, next);
      return;
    }
    activeUses.delete(id);
    if ((retainCounts.get(id) ?? 0) > 0) {
      return;
    }
    if (releasePending.delete(id)) {
      evictKey(id);
      return;
    }
    scheduleUnretainedEviction(id);
  };

  const acquireResident = async (connectionId: string, threadId: string): Promise<() => void> => {
    const id = threadUiStateKey(connectionId, threadId);
    activeUses.set(id, (activeUses.get(id) ?? 0) + 1);
    try {
      await model.ready;
      let resident = residents.get(id);
      if (resident === undefined) {
        const options = threadUiStateSubset(connectionId, threadId);
        const loading = Promise.resolve(collection._sync.loadSubset(options))
          .then(() => undefined)
          .catch((error: unknown) => {
            if (residents.get(id)?.loading === loading) {
              residents.delete(id);
              collection._sync.unloadSubset(options);
            }
            throw error;
          });
        resident = { loading, options };
        residents.set(id, resident);
      }
      await resident.loading;
    } catch (error) {
      finishUse(id);
      throw error;
    }
    let acquired = true;
    return () => {
      if (!acquired) {
        return;
      }
      acquired = false;
      finishUse(id);
    };
  };

  const releaseKey = (id: string): void => {
    const next = (retainCounts.get(id) ?? 1) - 1;
    if (next > 0) {
      retainCounts.set(id, next);
      return;
    }
    retainCounts.delete(id);
    if ((activeUses.get(id) ?? 0) > 0) {
      return;
    }
    scheduleUnretainedEviction(id);
  };

  const get = (connectionId: string, threadId: string): ThreadUiStateRow | null =>
    collection.get(threadUiStateKey(connectionId, threadId)) ?? null;

  const publishRow = (id: string): void => {
    rows.get(id)?.set(collection.get(id) ?? null);
  };

  const row$ = (connectionId: string, threadId: string): Observable<ThreadUiStateRow | null> => {
    const id = threadUiStateKey(connectionId, threadId);
    const existing = rows.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = observable<ThreadUiStateRow | null>(collection.get(id) ?? null);
    rows.set(id, created);
    return created;
  };

  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        publishRow(String(change.key));
      }
    },
    { includeInitialState: false },
  );

  const patch = async (
    connectionId: string,
    threadId: string,
    apply: (draft: ThreadUiStateRow) => void,
  ): Promise<void> => {
    const id = threadUiStateKey(connectionId, threadId);
    const releaseResident = await acquireResident(connectionId, threadId);
    try {
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
    } finally {
      releaseResident();
    }
  };

  const getOrCreate = async (connectionId: string, threadId: string): Promise<ThreadUiStateRow> => {
    const id = threadUiStateKey(connectionId, threadId);
    const releaseResident = await acquireResident(connectionId, threadId);
    try {
      const existing = get(connectionId, threadId);
      if (existing !== null) {
        return existing;
      }
      const row = createDefaultRow(id, connectionId, threadId, () => undefined);
      const transaction = collection.insert(row);
      await transaction.isPersisted.promise;
      publishRow(id);
      return row;
    } finally {
      releaseResident();
    }
  };

  return {
    close() {
      subscription.unsubscribe();
      for (const timer of evictionTimers.values()) {
        clearTimeout(timer);
      }
      evictionTimers.clear();
      activeUses.clear();
      releasePending.clear();
      reads.clear();
      residents.clear();
      retainCounts.clear();
      rows.clear();
      model.close();
    },
    async deleteConnection(connectionId) {
      await model.ready;
      const affectedKeys = collectConnectionKeys(connectionId, [
        activeUses.keys(),
        releasePending,
        reads.keys(),
        rows.keys(),
        residents.keys(),
        retainCounts.keys(),
      ]);
      for (const key of affectedKeys) {
        invalidateKey(key);
      }
      const options = connectionThreadUiStateSubset(connectionId);
      await collection._sync.loadSubset(options);
      try {
        const keys = collection.toArray
          .filter((row) => row.connectionId === connectionId)
          .map((row) => row.id);
        if (keys.length === 0) {
          return;
        }
        const transaction = collection.delete(keys);
        await transaction.isPersisted.promise;
      } finally {
        collection._sync.unloadSubset(options);
      }
    },
    async deleteThread(connectionId, threadId) {
      const id = threadUiStateKey(connectionId, threadId);
      const releaseResident = await acquireResident(connectionId, threadId);
      try {
        if (collection.get(id) !== undefined) {
          const transaction = collection.delete(id);
          await transaction.isPersisted.promise;
        }
      } finally {
        invalidateKey(id);
        releaseResident();
      }
    },
    get,
    getOrCreate,
    // WHY: React.use requires the cached Promise itself; async would wrap it on every call.
    // oxlint-disable-next-line typescript/promise-function-async
    read(connectionId, threadId) {
      const id = threadUiStateKey(connectionId, threadId);
      let resource = reads.get(id);
      if (resource === undefined) {
        resource = getOrCreate(connectionId, threadId)
          .then((row) => {
            row$(connectionId, threadId).set(row);
            return row;
          })
          .catch((error: unknown) => {
            if (reads.get(id) === resource) {
              reads.delete(id);
            }
            throw error;
          });
        reads.set(id, resource);
      }
      return resource;
    },
    ready: model.ready,
    async removeAttachment(connectionId, threadId, attachmentId) {
      await patch(connectionId, threadId, (draft) => {
        draft.attachments = draft.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        );
      });
    },
    retain(connectionId, threadId) {
      const id = threadUiStateKey(connectionId, threadId);
      cancelEviction(id);
      releasePending.delete(id);
      retainCounts.set(id, (retainCounts.get(id) ?? 0) + 1);
      let retained = true;
      return () => {
        if (!retained) {
          return;
        }
        retained = false;
        releaseKey(id);
      };
    },
    row$,
    async saveAttachments(connectionId, threadId, attachments) {
      const value = sanitizeDraftAttachments(attachments);
      await patch(connectionId, threadId, (draft) => {
        draft.attachments = value;
      });
    },
    async saveDraft(connectionId, threadId, text) {
      const value = boundedDraft(text);
      await patch(connectionId, threadId, (draft) => {
        draft.draftText = value;
      });
    },
    async savePreferences(connectionId, threadId, preferences) {
      const value = clonePreferences(preferences);
      await patch(connectionId, threadId, (draft) => {
        draft.preferences = value;
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
    async upsertAttachment(connectionId, threadId, attachment, isCurrent) {
      const value = sanitizeDraftAttachments([attachment])[0];
      if (value === undefined) {
        throw new Error("Invalid draft attachment");
      }
      await patch(connectionId, threadId, (draft) => {
        if (!isCurrent()) {
          return;
        }
        const index = draft.attachments.findIndex((item) => item.id === value.id);
        if (index < 0) {
          draft.attachments.push(value);
        } else {
          draft.attachments[index] = value;
        }
      });
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
    attachments: [],
    connectionId,
    draftText: "",
    historyAnchorOffsetPx: null,
    historyAnchorTurnId: null,
    id,
    preferences: null,
    scrollOffset: null,
    threadId,
    updatedAt: Date.now(),
  };
  apply(row);
  return row;
}

function boundedDraft(text: string): string {
  if (text.length > MAX_TURN_TEXT_CHARS) {
    throw new Error(`Draft exceeds ${String(MAX_TURN_TEXT_CHARS)} characters`);
  }
  return text;
}

function boundedScrollOffset(offset: number | null): number | null {
  if (offset === null) {
    return null;
  }
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

function boundedHistoryAnchor(turnId: string | null): string | null {
  if (turnId === null) {
    return null;
  }
  return turnId.length > 0 && turnId.length <= 512 && !/[\u0000-\u001F\u007F]/u.test(turnId)
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
        serviceTier: preferences.serviceTier,
        skillPaths: preferences.skillPaths.slice(0, 256),
      };
}

function sanitizeDraftAttachments(value: unknown): StoredDraftAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 128).flatMap((raw) => {
    const attachment = unknownRecord(raw);
    if (attachment === null) {
      return [];
    }
    const { editor, id, kind, name, path, preview, rootId } = attachment;
    if (
      typeof id !== "string" ||
      id.length < 1 ||
      id.length > 128 ||
      typeof rootId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId) ||
      typeof path !== "string" ||
      path.length < 1 ||
      path.length > 4096 ||
      /[\u0000-\u001F\u007F]/u.test(path) ||
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 4096 ||
      /[\u0000-\u001F\u007F]/u.test(name) ||
      (kind !== "image" && kind !== "audio" && kind !== "file")
    ) {
      return [];
    }
    const quickdrawEditor = sanitizeQuickdrawEditor(editor);
    const localPreview = sanitizeAttachmentPreview(preview);
    return [
      {
        id,
        kind,
        name,
        path,
        rootId,
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
  ) {
    return null;
  }
  const { bytes, mimeType, text, uri } = value;
  if (
    uri !== null &&
    (typeof uri !== "string" || uri.length > 4096 || !/^(?:file|content):\/\//u.test(uri))
  ) {
    return null;
  }
  if (text !== null && (typeof text !== "string" || text.length > 512)) {
    return null;
  }
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof mimeType !== "string" ||
    mimeType.length > 256
  ) {
    return null;
  }
  return { bytes, mimeType, text, uri };
}

function sanitizeQuickdrawEditor(value: unknown): QuickdrawDraftState | null {
  const editor = unknownRecord(value);
  if (editor === null) {
    return null;
  }
  const { kind, mode, revision, snapshot } = editor;
  const validatedSnapshot = unknownRecord(snapshot);
  if (
    kind !== "quickdraw" ||
    (mode !== "drawing" && mode !== "image-annotation") ||
    validatedSnapshot === null ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    return null;
  }
  return { kind, mode, revision, snapshot: validatedSnapshot };
}

function threadUiStateKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function collectConnectionKeys(
  connectionId: string,
  sources: readonly Iterable<string>[],
): Set<string> {
  const prefix = `${connectionId}\u0000`;
  const keys = new Set<string>();
  for (const source of sources) {
    for (const key of source) {
      if (key.startsWith(prefix)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function connectionThreadUiStateSubset(connectionId: string): LoadSubsetOptions {
  return {
    where: new IR.Func("eq", [new IR.PropRef(["connectionId"]), new IR.Value(connectionId)]),
  };
}

function threadUiStateSubset(connectionId: string, threadId: string): LoadSubsetOptions {
  return {
    where: new IR.Func("and", [
      new IR.Func("eq", [new IR.PropRef(["connectionId"]), new IR.Value(connectionId)]),
      new IR.Func("eq", [new IR.PropRef(["threadId"]), new IR.Value(threadId)]),
    ]),
  };
}
