import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { parseLiveActivity, type LiveActivity } from "@codewide/sync-client";
import { plainThreadPreview } from "./thread-cache";
import { isThread } from "./thread-cursor-sync";
import {
  normalizeThreadStatus,
  threadSummaryProjectionCursor,
  type StoredThreadSummary,
} from "./thread-summary-types";
import { readThreadAgent } from "./threadAgent";
import { threadPinFromSnapshot } from "./threadPinState";
import { unknownRecord } from "./unknownRecord";

/**
 * Wire adapter for Companion thread-list rows: the `threadListRows` push frame
 * and every `thread/list` row, which carry the same `codewideList` metadata
 * (docs/companion-thread-list-stream.md). Values leave this module only after
 * validation; stores never read raw wire rows. `serverRowSummary` maps a
 * validated row onto the server-owned fields of a stored summary.
 */

const MAX_ROWS_PER_FRAME = 100;

/** Device mirror of contract/v1.json `threadListStream`; the contract test pins these literals. */
export const THREAD_LIST_STREAM_CONTRACT = {
  controlFrame: "listStream",
  frame: "threadListRows",
  helloField: "listStream",
  maxRowsPerFrame: MAX_ROWS_PER_FRAME,
  rowField: "codewideList",
} as const;

const MAX_THREAD_ID_CHARS = 256;

declare const listStreamGenerationBrand: unique symbol;
declare const listRowThreadIdBrand: unique symbol;

/** Native transport generation of one socket; rows and pages of another generation are stale. */
export type ListStreamGeneration = number & { readonly [listStreamGenerationBrand]: true };

/** A validated thread identity of one list row or tombstone. */
export type ListRowThreadId = string & { readonly [listRowThreadIdBrand]: true };

/** `codewideList`: the Companion journal cursor of the row's last change and its list state. */
type ListRowMeta = {
  readonly archived: boolean;
  readonly cursor: number;
  readonly liveActivity: LiveActivity | null;
};

/** One server row: `thread/list` metadata without turns plus its list metadata. */
export type ThreadListRow = {
  readonly meta: ListRowMeta;
  readonly thread: Thread;
  readonly threadId: ListRowThreadId;
};

/** A row removal with the cursor of the change that removed it. */
type RowTombstone = {
  readonly cursor: number;
  readonly threadId: ListRowThreadId;
};

export type ThreadListRowsFrame = {
  readonly removed: readonly RowTombstone[];
  readonly rows: readonly ThreadListRow[];
};

export type ListRowParse<Value> =
  | { readonly status: "ok"; readonly value: Value }
  | { readonly error: string; readonly status: "error" };

export function isListStreamGeneration(value: unknown): value is ListStreamGeneration {
  return isCursor(value);
}

function isListRowThreadId(value: unknown): value is ListRowThreadId {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_THREAD_ID_CHARS;
}

function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function failure(error: string): { readonly error: string; readonly status: "error" } {
  return { error, status: "error" };
}

/**
 * A non-null activity this client cannot read clears the label, the rule of
 * `liveActivityChangeFromPatch`, instead of rejecting the whole row.
 */
function parseRowActivity(value: unknown): LiveActivity | null {
  return value === null ? null : parseLiveActivity(value);
}

function parseListRowMeta(value: unknown): ListRowMeta | null {
  const meta = unknownRecord(value);
  if (
    meta === null ||
    !isCursor(meta.cursor) ||
    typeof meta.archived !== "boolean" ||
    !("liveActivity" in meta)
  ) {
    return null;
  }
  return {
    archived: meta.archived,
    cursor: meta.cursor,
    liveActivity: parseRowActivity(meta.liveActivity),
  };
}

/** Validates one `thread/list` or pushed row, including its `codewideList` metadata. */
export function parseThreadListRow(value: unknown): ListRowParse<ThreadListRow> {
  if (
    !isThread(value) ||
    typeof value.preview !== "string" ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt)
  ) {
    return failure("invalid thread metadata");
  }
  if (!isListRowThreadId(value.id)) {
    return failure("invalid thread id");
  }
  const meta = parseListRowMeta(unknownRecord(value)?.[THREAD_LIST_STREAM_CONTRACT.rowField]);
  if (meta === null) {
    return failure("invalid list metadata");
  }
  return { status: "ok", value: { meta, thread: value, threadId: value.id } };
}

/** Validates the rows of a page or native snapshot; one invalid row rejects them all. */
export function parseThreadListRows(candidates: readonly unknown[]): ListRowParse<ThreadListRow[]> {
  return parseFrameRows(candidates, new Set());
}

function parseTombstone(value: unknown): RowTombstone | null {
  const tombstone = unknownRecord(value);
  if (tombstone === null || !isListRowThreadId(tombstone.threadId) || !isCursor(tombstone.cursor)) {
    return null;
  }
  return { cursor: tombstone.cursor, threadId: tombstone.threadId };
}

/** Adds one frame entry's identity; a repeated thread id invalidates the frame. */
function claimThreadId(seen: Set<string>, threadId: ListRowThreadId): boolean {
  if (seen.has(threadId)) {
    return false;
  }
  seen.add(threadId);
  return true;
}

function parseFrameRows(
  candidates: readonly unknown[],
  seen: Set<string>,
): ListRowParse<ThreadListRow[]> {
  const rows: ThreadListRow[] = [];
  for (const candidate of candidates) {
    const row = parseThreadListRow(candidate);
    if (row.status === "error") {
      return row;
    }
    if (!claimThreadId(seen, row.value.threadId)) {
      return failure("repeated thread id");
    }
    rows.push(row.value);
  }
  return { status: "ok", value: rows };
}

function parseFrameTombstones(
  candidates: readonly unknown[],
  seen: Set<string>,
): ListRowParse<RowTombstone[]> {
  const removed: RowTombstone[] = [];
  for (const candidate of candidates) {
    const tombstone = parseTombstone(candidate);
    if (tombstone === null) {
      return failure("invalid tombstone");
    }
    if (!claimThreadId(seen, tombstone.threadId)) {
      return failure("repeated thread id");
    }
    removed.push(tombstone);
  }
  return { status: "ok", value: removed };
}

/** The frame's arrays when its envelope and size bound are valid. */
function frameEntries(
  value: unknown,
): ListRowParse<{ readonly removed: readonly unknown[]; readonly rows: readonly unknown[] }> {
  const frame = unknownRecord(value);
  if (
    frame?.type !== THREAD_LIST_STREAM_CONTRACT.frame ||
    !Array.isArray(frame.rows) ||
    !Array.isArray(frame.removed)
  ) {
    return failure("invalid frame envelope");
  }
  const size = frame.rows.length + frame.removed.length;
  return size === 0 || size > MAX_ROWS_PER_FRAME
    ? failure("invalid frame size")
    : { status: "ok", value: { removed: frame.removed, rows: frame.rows } };
}

/**
 * Validates one `threadListRows` frame. A single invalid row, a repeated
 * thread id or a broken bound makes the whole frame invalid.
 */
export function parseThreadListRowsFrame(value: unknown): ListRowParse<ThreadListRowsFrame> {
  const entries = frameEntries(value);
  if (entries.status === "error") {
    return entries;
  }
  const seen = new Set<string>();
  const rows = parseFrameRows(entries.value.rows, seen);
  if (rows.status === "error") {
    return rows;
  }
  const removed = parseFrameTombstones(entries.value.removed, seen);
  return removed.status === "error"
    ? removed
    : { status: "ok", value: { removed: removed.value, rows: rows.value } };
}

/** The shell of `thread/started` stays until a row shows newer activity than it. */
function retainedShell(
  previous: StoredThreadSummary | undefined,
  row: ThreadListRow,
): Thread | null {
  const shell = previous?.provisionalThread;
  return isThread(shell) && row.thread.updatedAt <= shell.updatedAt ? shell : null;
}

type DeviceFields = Pick<
  StoredThreadSummary,
  | "activeSubagents"
  | "closedQuestionTurnId"
  | "deleteCommandId"
  | "firstUnreadAgentTurnId"
  | "lastSeenCursor"
  | "latestActivityCursor"
  | "pendingQuestion"
  | "pendingRequestCount"
  | "projectionCursor"
  | "skippedQuestions"
  | "submittedQuestions"
  | "unread"
>;

const NEW_ROW_DEVICE_FIELDS: DeviceFields = {
  closedQuestionTurnId: null,
  deleteCommandId: null,
  firstUnreadAgentTurnId: null,
  lastSeenCursor: 0,
  latestActivityCursor: 0,
  pendingQuestion: null,
  pendingRequestCount: 0,
  projectionCursor: 0,
  skippedQuestions: null,
  submittedQuestions: null,
  unread: 0,
};

/** Device-owned fields a server row never writes. */
function deviceFields(previous: StoredThreadSummary | undefined): DeviceFields {
  if (previous === undefined) {
    return NEW_ROW_DEVICE_FIELDS;
  }
  return {
    ...(previous.activeSubagents === undefined
      ? {}
      : { activeSubagents: previous.activeSubagents }),
    closedQuestionTurnId: previous.closedQuestionTurnId ?? null,
    deleteCommandId: previous.deleteCommandId,
    firstUnreadAgentTurnId: previous.firstUnreadAgentTurnId ?? null,
    lastSeenCursor: previous.lastSeenCursor,
    latestActivityCursor: previous.latestActivityCursor,
    pendingQuestion: previous.pendingQuestion ?? null,
    pendingRequestCount: previous.pendingRequestCount,
    // The journal-event version of device fields, independent of the row cursor.
    projectionCursor: threadSummaryProjectionCursor(previous),
    skippedQuestions: previous.skippedQuestions ?? null,
    submittedQuestions: previous.submittedQuestions ?? null,
    unread: previous.unread,
  };
}

/** The pin carries its own server cursor; an older row cannot undo a newer pin change. */
function serverPin(
  thread: Thread,
  previous: StoredThreadSummary | undefined,
): Pick<StoredThreadSummary, "pinCursor" | "pinned"> {
  const pin = threadPinFromSnapshot(thread);
  const previousPinCursor = previous?.pinCursor ?? 0;
  return previous !== undefined && previousPinCursor > pin.cursor
    ? { pinCursor: previousPinCursor, pinned: previous.pinned }
    : { pinCursor: pin.cursor, pinned: pin.pinned };
}

/** Descriptors a row may omit; the provider and repository are fixed per thread. */
function retainedDescriptors(
  thread: Thread,
  previous: StoredThreadSummary | undefined,
): Pick<StoredThreadSummary, "codewideAgent" | "gitOriginUrl"> {
  return {
    codewideAgent: readThreadAgent(thread) ?? previous?.codewideAgent ?? null,
    gitOriginUrl: thread.gitInfo?.originUrl ?? previous?.gitOriginUrl ?? null,
  };
}

/** Replaces the server fields of `previous` with one validated row. */
export function serverRowSummary(
  connectionId: string,
  row: ThreadListRow,
  previous: StoredThreadSummary | undefined,
): StoredThreadSummary {
  const { meta, thread } = row;
  return {
    ...deviceFields(previous),
    ...retainedDescriptors(thread, previous),
    ...serverPin(thread, previous),
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    archived: meta.archived,
    connectionId,
    cwd: thread.cwd,
    name: thread.name,
    parentThreadId: thread.parentThreadId ?? null,
    preview: plainThreadPreview(thread.preview),
    provisionalThread: retainedShell(previous, row),
    recencyAt: thread.recencyAt,
    remoteThreadId: thread.id,
    status: normalizeThreadStatus(thread.status),
    updatedAt: thread.updatedAt,
  };
}
