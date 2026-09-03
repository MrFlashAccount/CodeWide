import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type {
  ComposerDraftStore,
  PersistedComposerDraft,
  PersistedComposerDraftAttachment,
} from "../../application/ports/composerDraftStore";
import type { ComposerAttachmentEditorMetadata } from "../../application/composer/composerAttachmentTypes";
import { savedServerId } from "../../domain/ids";
import { getV2SqliteDatabase } from "./v2Database.native";
import { parsePersistedNewThreadDraft } from "./parsePersistedNewThreadDraft";

const TABLE = "codewide_v2_composer_drafts";
const QUARANTINE_TABLE = "codewide_v2_composer_draft_quarantine";
const MAX_TEXT_CHARS = 2_000_000;
const MAX_ATTACHMENTS = 64;

export function createComposerDraftStore(): ComposerDraftStore {
  return createComposerDraftStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regression tests. */
export function createComposerDraftStoreWithDatabase(database: SqliteDatabase): ComposerDraftStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          "saved_server_id TEXT NOT NULL, draft_id TEXT NOT NULL, payload TEXT NOT NULL, " +
          "updated_at_ms INTEGER NOT NULL, PRIMARY KEY(saved_server_id, draft_id))",
      );
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (` +
          "saved_server_id TEXT NOT NULL, draft_id TEXT NOT NULL, reason TEXT NOT NULL, " +
          "quarantined_at_ms INTEGER NOT NULL, PRIMARY KEY(saved_server_id, draft_id))",
      );
    });
    await prepared;
  };
  return {
    async delete(server, draftId) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ? AND draft_id = ?`, [
          server,
          draftId,
        ]);
      });
    },
    async deleteSavedServer(server) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [server]);
        await executor.execute(`DELETE FROM ${QUARANTINE_TABLE} WHERE saved_server_id = ?`, [
          server,
        ]);
      });
    },
    async load() {
      await prepare();
      return database.transaction(async (executor) => loadValid(executor));
    },
    async upsert(record) {
      validateDraft(record);
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(
          `INSERT INTO ${TABLE}(saved_server_id, draft_id, payload, updated_at_ms) ` +
            "VALUES (?, ?, ?, ?) ON CONFLICT(saved_server_id, draft_id) DO UPDATE SET " +
            "payload = excluded.payload, updated_at_ms = excluded.updated_at_ms",
          [record.savedServerId, record.draftId, JSON.stringify(record), record.updatedAtMs],
        );
        await executor.execute(
          `DELETE FROM ${QUARANTINE_TABLE} WHERE saved_server_id = ? AND draft_id = ?`,
          [record.savedServerId, record.draftId],
        );
      });
    },
  };
}

async function loadValid(executor: SqliteExecutor): Promise<PersistedComposerDraft[]> {
  const rows = extractRows(
    await executor.execute(`SELECT saved_server_id, draft_id, payload FROM ${TABLE}`),
  );
  const result: PersistedComposerDraft[] = [];
  for (const row of rows) {
    const server = row.saved_server_id;
    const draftId = row.draft_id;
    const parsed = parsePayload(row.payload);
    if (parsed !== null && parsed.savedServerId === server && parsed.draftId === draftId) {
      result.push(parsed);
      continue;
    }
    if (typeof server === "string" && typeof draftId === "string") {
      await quarantine(executor, server, draftId);
    }
  }
  return result;
}

async function quarantine(
  executor: SqliteExecutor,
  server: string,
  draftId: string,
): Promise<void> {
  await executor.execute(
    `INSERT INTO ${QUARANTINE_TABLE}(saved_server_id, draft_id, reason, quarantined_at_ms) ` +
      "VALUES (?, ?, ?, ?) ON CONFLICT(saved_server_id, draft_id) DO UPDATE SET " +
      "reason = excluded.reason, quarantined_at_ms = excluded.quarantined_at_ms",
    [server, draftId, "invalid_payload", Date.now()],
  );
  await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ? AND draft_id = ?`, [
    server,
    draftId,
  ]);
}

function parsePayload(value: SqliteValue | undefined): PersistedComposerDraft | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parseDraft(parsed);
  } catch {
    return null;
  }
}

function parseDraft(value: unknown): PersistedComposerDraft | null {
  if (!isRecord(value)) return null;
  const server = value.savedServerId;
  const draftId = value.draftId;
  const text = value.text;
  const deliveryMode = value.deliveryMode;
  const history = parseHistoryPosition(value);
  const parsedNewThread = parsePersistedNewThreadDraft(value.newThread);
  const updatedAtMs = value.updatedAtMs;
  const attachments = value.attachments;
  if (
    typeof server !== "string" ||
    typeof draftId !== "string" ||
    !validDraftId(draftId) ||
    typeof text !== "string" ||
    text.length > MAX_TEXT_CHARS ||
    !isDeliveryMode(deliveryMode) ||
    history === null ||
    parsedNewThread === undefined ||
    typeof updatedAtMs !== "number" ||
    !Number.isSafeInteger(updatedAtMs) ||
    !Array.isArray(attachments) ||
    attachments.length > MAX_ATTACHMENTS
  ) {
    return null;
  }
  const parsedAttachments: PersistedComposerDraftAttachment[] = [];
  for (const attachment of attachments) {
    const parsed = parseAttachment(attachment);
    if (parsed === null) return null;
    parsedAttachments.push(parsed);
  }
  try {
    return {
      attachments: parsedAttachments,
      deliveryMode,
      draftId,
      ...history,
      newThread: parsedNewThread,
      savedServerId: savedServerId(server),
      text,
      updatedAtMs,
    };
  } catch {
    return null;
  }
}

function parseHistoryPosition(
  value: Record<string, unknown>,
): Pick<
  PersistedComposerDraft,
  | "historyAnchorOffsetPx"
  | "historyAnchorTurnId"
  | "historyGenerationId"
  | "historyPageCursor"
  | "historyPageDirection"
> | null {
  const historyAnchorTurnId = value.historyAnchorTurnId ?? null;
  const historyAnchorOffsetPx = value.historyAnchorOffsetPx ?? null;
  const historyGenerationId = value.historyGenerationId ?? null;
  const historyPageCursor = value.historyPageCursor ?? null;
  const historyPageDirection = value.historyPageDirection ?? null;
  if (
    (historyAnchorTurnId !== null &&
      (typeof historyAnchorTurnId !== "string" || historyAnchorTurnId.length > 256)) ||
    (historyAnchorOffsetPx !== null &&
      (typeof historyAnchorOffsetPx !== "number" ||
        !Number.isFinite(historyAnchorOffsetPx) ||
        Math.abs(historyAnchorOffsetPx) > 10_000_000)) ||
    (historyGenerationId !== null &&
      (typeof historyGenerationId !== "string" || historyGenerationId.length > 256)) ||
    (historyPageCursor !== null &&
      (typeof historyPageCursor !== "string" || historyPageCursor.length > 4096)) ||
    (historyPageDirection !== null &&
      historyPageDirection !== "newer" &&
      historyPageDirection !== "older")
  ) {
    return null;
  }
  if (historyAnchorTurnId === null) {
    if (
      historyAnchorOffsetPx !== null ||
      historyGenerationId !== null ||
      historyPageCursor !== null ||
      historyPageDirection !== null
    ) {
      return null;
    }
  } else {
    const pageValues = [historyGenerationId, historyPageCursor, historyPageDirection];
    const pageValueCount = pageValues.filter((field) => field !== null).length;
    if (pageValueCount !== 0 && pageValueCount !== pageValues.length) return null;
  }
  return {
    historyAnchorOffsetPx,
    historyAnchorTurnId,
    historyGenerationId,
    historyPageCursor,
    historyPageDirection,
  };
}

function parseAttachment(value: unknown): PersistedComposerDraftAttachment | null {
  if (!isRecord(value) || !isRecord(value.local)) return null;
  const local = value.local;
  const editor = parseEditor(value.editor);
  const error = value.error;
  const remoteId = value.remoteId;
  const state = value.state;
  if (
    (value.editor !== null && editor === null) ||
    (error !== null && typeof error !== "string") ||
    (remoteId !== null && typeof remoteId !== "string") ||
    (state !== "selected" && state !== "ready" && state !== "error") ||
    typeof local.mediaType !== "string" ||
    local.mediaType.length === 0 ||
    local.mediaType.length > 256 ||
    typeof local.name !== "string" ||
    local.name.length === 0 ||
    local.name.length > 256 ||
    typeof local.sizeBytes !== "number" ||
    !Number.isSafeInteger(local.sizeBytes) ||
    local.sizeBytes < 0 ||
    typeof local.token !== "string" ||
    local.token.length === 0 ||
    local.token.length > 4096
  ) {
    return null;
  }
  return {
    editor,
    error,
    local: {
      mediaType: local.mediaType,
      name: local.name,
      sizeBytes: local.sizeBytes,
      token: local.token,
    },
    remoteId,
    state,
  };
}

function parseEditor(value: unknown): ComposerAttachmentEditorMetadata | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    value.kind !== "quickdraw" ||
    (value.mode !== "drawing" && value.mode !== "imageAnnotation") ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.snapshot !== "string"
  ) {
    return null;
  }
  return {
    kind: "quickdraw",
    mode: value.mode,
    revision: value.revision,
    snapshot: value.snapshot,
  };
}

function validateDraft(value: PersistedComposerDraft): void {
  if (parseDraft(value) === null) throw new Error("Composer draft is invalid");
}

function validDraftId(value: string): boolean {
  return value.length > 0 && value.length <= 512;
}

function isDeliveryMode(value: unknown): value is PersistedComposerDraft["deliveryMode"] {
  return value === "sendNow" || value === "queue" || value === "steer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRows(value: unknown): Record<string, SqliteValue>[] {
  if (Array.isArray(value)) return value.filter(isSqliteRow);
  if (!isRecord(value)) return [];
  return Array.isArray(value.rows) ? value.rows.filter(isSqliteRow) : [];
}

function isSqliteRow(value: unknown): value is Record<string, SqliteValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
