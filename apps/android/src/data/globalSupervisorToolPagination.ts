import {
  parseGlobalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import type { GlobalSupervisorChatItem } from "./globalSupervisorToolRouter";
import { unknownRecord } from "./unknownRecord";

type CatalogCursor = {
  readonly connectionId: string;
  readonly connectionOrder: readonly string[];
  readonly kind: "listChats";
  readonly remoteCursor: string | null;
  readonly version: 1;
};

type HistoryCursor = {
  readonly itemOffset: number;
  readonly kind: "readChat";
  readonly remoteCursor: string | null;
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly version: 1;
};

export type GlobalSupervisorCatalogThread = {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string;
  readonly threadSource: string | null;
};

function validString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function decodeCursor(cursor: string, invalidMessage: string): unknown {
  try {
    return JSON.parse(cursor);
  } catch {
    throw new Error(invalidMessage);
  }
}

function isRemoteCursor(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): boolean {
  return Object.keys(record).every((key) => keys.has(key));
}

const catalogCursorKeys = new Set([
  "connectionId",
  "connectionOrder",
  "kind",
  "remoteCursor",
  "version",
]);
const historyCursorKeys = new Set(["itemOffset", "kind", "remoteCursor", "target", "version"]);

function isExactConnectionOrder(value: unknown, expected: readonly string[]): value is string[] {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const connectionId: unknown = value[index];
    if (!validString(connectionId) || connectionId !== expected[index] || seen.has(connectionId)) {
      return false;
    }
    seen.add(connectionId);
  }
  return true;
}

type CatalogCursorMetadata = Omit<CatalogCursor, "connectionOrder"> & {
  readonly connectionOrder: unknown;
};

function isCatalogCursorMetadata(
  record: Readonly<Record<string, unknown>> | null,
): record is Readonly<Record<string, unknown>> & CatalogCursorMetadata {
  return (
    record !== null &&
    hasOnlyKeys(record, catalogCursorKeys) &&
    record.kind === "listChats" &&
    record.version === 1 &&
    validString(record.connectionId) &&
    isRemoteCursor(record.remoteCursor)
  );
}

/** Validates one list continuation against the exact enabled-connection snapshot. */
export function parseGlobalSupervisorCatalogCursor(
  cursor: string | null,
  connectionOrder: readonly string[],
): { readonly connectionIndex: number; readonly remoteCursor: string | null } {
  if (cursor === null) {
    return { connectionIndex: 0, remoteCursor: null };
  }
  const record = unknownRecord(decodeCursor(cursor, "The listChats cursor is invalid"));
  if (!isCatalogCursorMetadata(record)) {
    throw new Error("The listChats cursor is invalid");
  }
  if (!isExactConnectionOrder(record.connectionOrder, connectionOrder)) {
    throw new Error("The listChats cursor is invalid");
  }
  const connectionIndex = connectionOrder.indexOf(record.connectionId);
  if (connectionIndex < 0) {
    throw new Error("The listChats cursor is stale");
  }
  return { connectionIndex, remoteCursor: record.remoteCursor };
}

/** Encodes content-free catalog continuation state scoped to one connection snapshot. */
export function globalSupervisorCatalogCursor(
  connectionId: string,
  connectionOrder: readonly string[],
  remoteCursor: string | null,
): string {
  return JSON.stringify({
    connectionId,
    connectionOrder,
    kind: "listChats",
    remoteCursor,
    version: 1,
  } satisfies CatalogCursor);
}

function validItemOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

type HistoryCursorMetadata = Omit<HistoryCursor, "target"> & { readonly target: unknown };

function isHistoryCursorMetadata(
  record: Readonly<Record<string, unknown>> | null,
): record is Readonly<Record<string, unknown>> & HistoryCursorMetadata {
  return (
    record !== null &&
    hasOnlyKeys(record, historyCursorKeys) &&
    record.kind === "readChat" &&
    record.version === 1 &&
    validItemOffset(record.itemOffset) &&
    isRemoteCursor(record.remoteCursor)
  );
}

/** Validates one history continuation against its exact qualified target. */
export function parseGlobalSupervisorHistoryCursor(
  cursor: string | null,
  target: GlobalSupervisorQualifiedChatRef,
): { readonly itemOffset: number; readonly remoteCursor: string | null } {
  if (cursor === null) {
    return { itemOffset: 0, remoteCursor: null };
  }
  const record = unknownRecord(decodeCursor(cursor, "The readChat cursor is invalid"));
  if (!isHistoryCursorMetadata(record)) {
    throw new Error("The readChat cursor is invalid");
  }
  const cursorTarget = parseGlobalSupervisorQualifiedChatRef(record.target);
  if (
    cursorTarget === null ||
    cursorTarget.connectionId !== target.connectionId ||
    cursorTarget.threadId !== target.threadId
  ) {
    throw new Error("The readChat cursor is invalid");
  }
  return { itemOffset: record.itemOffset, remoteCursor: record.remoteCursor };
}

/** Encodes content-free history continuation state scoped to one qualified target. */
export function globalSupervisorHistoryCursor(
  target: GlobalSupervisorQualifiedChatRef,
  remoteCursor: string | null,
  itemOffset: number,
): string | null {
  return remoteCursor === null && itemOffset === 0
    ? null
    : JSON.stringify({
        itemOffset,
        kind: "readChat",
        remoteCursor,
        target,
        version: 1,
      } satisfies HistoryCursor);
}

function parseCatalogThread(value: unknown): GlobalSupervisorCatalogThread {
  const thread = unknownRecord(value);
  if (thread === null || !validString(thread.id) || typeof thread.preview !== "string") {
    throw new Error("The chat catalog entry is invalid");
  }
  if (thread.name !== null && typeof thread.name !== "string") {
    throw new Error("The chat catalog entry is invalid");
  }
  if (thread.threadSource !== null && typeof thread.threadSource !== "string") {
    throw new Error("The chat catalog entry is invalid");
  }
  return {
    id: thread.id,
    name: thread.name,
    preview: thread.preview,
    threadSource: thread.threadSource,
  };
}

function boundedPageData(value: unknown, maxItems: number, invalidMessage: string): unknown[] {
  const page = unknownRecord(value);
  if (page === null || !Array.isArray(page.data)) {
    throw new Error(invalidMessage);
  }
  if (page.data.length > maxItems) {
    throw new Error(invalidMessage);
  }
  return page.data;
}

function pageNextCursor(
  value: unknown,
  requestedCursor: string | null,
  invalidMessage: string,
): string | null {
  const page = unknownRecord(value);
  const nextCursor = page?.nextCursor;
  if (nextCursor === null) {
    return null;
  }
  if (!validString(nextCursor) || nextCursor === requestedCursor) {
    throw new Error(invalidMessage);
  }
  return nextCursor;
}

/** Rejects over-return before projecting any untrusted catalog entry. */
export function parseGlobalSupervisorCatalogPage(
  value: unknown,
  maxEntries: number,
  requestedCursor: string | null,
): { readonly data: readonly GlobalSupervisorCatalogThread[]; readonly nextCursor: string | null } {
  const source = boundedPageData(value, maxEntries, "The chat catalog response is invalid");
  const nextCursor = pageNextCursor(value, requestedCursor, "The chat catalog cursor is invalid");
  const data: GlobalSupervisorCatalogThread[] = [];
  for (const entry of source) {
    data.push(parseCatalogThread(entry));
  }
  return { data, nextCursor };
}

export type GlobalSupervisorTurnHistoryPage = {
  readonly nextCursor: string | null;
  readonly turn: { readonly id: string; readonly items: readonly unknown[] } | null;
};

/** Validates one message-summary turn page without copying its item collection. */
export function parseGlobalSupervisorTurnHistoryPage(
  value: unknown,
  requestedCursor: string | null,
): GlobalSupervisorTurnHistoryPage {
  const source = boundedPageData(value, 1, "The chat history response is invalid");
  const nextCursor = pageNextCursor(value, requestedCursor, "The chat history cursor is invalid");
  const candidate = source[0];
  if (candidate === undefined) {
    return { nextCursor, turn: null };
  }
  const turn = unknownRecord(candidate);
  if (turn === null || !validString(turn.id) || !Array.isArray(turn.items)) {
    throw new Error("The chat history response is invalid");
  }
  return { nextCursor, turn: { id: turn.id, items: turn.items } };
}

function userMessageTextParts(contentValues: readonly unknown[]): readonly string[] {
  const textParts: string[] = [];
  for (const value of contentValues) {
    const content = unknownRecord(value);
    if (content === null || !validString(content.type)) {
      throw new Error("The user history content is invalid");
    }
    if (content.type === "text") {
      if (typeof content.text !== "string") {
        throw new Error("The user history text is invalid");
      }
      textParts.push(content.text);
    }
  }
  return textParts;
}

type HistoryItemProjection = {
  readonly id: string;
  readonly kind: GlobalSupervisorChatItem["kind"];
  readonly textParts: readonly string[];
};

function userMessageProjection(
  item: Readonly<Record<string, unknown>>,
  id: string,
): HistoryItemProjection | null {
  if (!Array.isArray(item.content)) {
    throw new Error("The user history item is invalid");
  }
  const textParts = userMessageTextParts(item.content);
  return textParts.length === 0 || (textParts.length === 1 && textParts[0] === "")
    ? null
    : { id, kind: "user", textParts };
}

function messageProjection(value: unknown): HistoryItemProjection | null {
  const item = unknownRecord(value);
  if (item === null || !validString(item.id) || !validString(item.type)) {
    throw new Error("The chat history item is invalid");
  }
  switch (item.type) {
    case "agentMessage":
      if (typeof item.text !== "string") {
        throw new Error("The assistant history item is invalid");
      }
      return { id: item.id, kind: "assistant", textParts: [item.text] };
    case "userMessage":
      return userMessageProjection(item, item.id);
    default:
      return null;
  }
}

const ASCII_MAX_CODE_POINT = 0x7f;
const TWO_BYTE_MAX_CODE_POINT = 0x07_ff;
const BASIC_MULTILINGUAL_PLANE_MAX_CODE_POINT = 0xff_ff;
const ASCII_UTF8_BYTES = 1;
const TWO_BYTE_UTF8_BYTES = 2;
const THREE_BYTE_UTF8_BYTES = 3;
const FOUR_BYTE_UTF8_BYTES = 4;
const JSON_SHORT_ESCAPE_BYTES = 2;
const JSON_UNICODE_ESCAPE_BYTES = 6;
const JSON_CONTROL_MAX_CODE_POINT = 0x20;
const JSON_ARRAY_SEPARATOR_BYTES = 2;
const ASSISTANT_PROJECTION_FIXED_BYTES = 38;
const USER_PROJECTION_FIXED_BYTES = 33;
const JSON_SHORT_ESCAPES = new Set(['"', "\\", "\b", "\f", "\n", "\r", "\t"]);

function utf8CodePointBytes(codePoint: number): number {
  if (codePoint <= ASCII_MAX_CODE_POINT) {
    return ASCII_UTF8_BYTES;
  }
  if (codePoint <= TWO_BYTE_MAX_CODE_POINT) {
    return TWO_BYTE_UTF8_BYTES;
  }
  return codePoint <= BASIC_MULTILINGUAL_PLANE_MAX_CODE_POINT
    ? THREE_BYTE_UTF8_BYTES
    : FOUR_BYTE_UTF8_BYTES;
}

function jsonCharacterBytes(character: string, codePoint: number): number {
  if (JSON_SHORT_ESCAPES.has(character)) {
    return JSON_SHORT_ESCAPE_BYTES;
  }
  return codePoint < JSON_CONTROL_MAX_CODE_POINT
    ? JSON_UNICODE_ESCAPE_BYTES
    : utf8CodePointBytes(codePoint);
}

function jsonStringContentBytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    bytes += jsonCharacterBytes(character, codePoint);
  }
  return bytes;
}

function projectionBytes(projection: HistoryItemProjection): number {
  const fixed =
    projection.kind === "assistant"
      ? ASSISTANT_PROJECTION_FIXED_BYTES
      : USER_PROJECTION_FIXED_BYTES;
  let bytes = fixed + jsonStringContentBytes(projection.id);
  for (let index = 0; index < projection.textParts.length; index += 1) {
    if (index > 0) {
      bytes += JSON_ARRAY_SEPARATOR_BYTES;
    }
    bytes += jsonStringContentBytes(projection.textParts[index] ?? "");
  }
  return bytes;
}

function materializeProjection(projection: HistoryItemProjection): GlobalSupervisorChatItem {
  return {
    id: projection.id,
    kind: projection.kind,
    text:
      projection.textParts.length === 1
        ? (projection.textParts[0] ?? "")
        : projection.textParts.join("\n"),
  };
}

function oversizedProjection(projection: HistoryItemProjection): GlobalSupervisorChatItem {
  return { id: projection.id, kind: projection.kind, text: "[Message exceeds read limit]" };
}

function oversizedProjectionBytes(projection: HistoryItemProjection): number {
  return projectionBytes({
    id: projection.id,
    kind: projection.kind,
    textParts: ["[Message exceeds read limit]"],
  });
}

function appendProjection(
  projection: HistoryItemProjection,
  output: {
    readonly items: GlobalSupervisorChatItem[];
    readonly maxBytes: number;
    readonly previousBytes: number;
  },
): { readonly bytes: number; readonly consumed: boolean; readonly stop: boolean } {
  const nextBytes = output.previousBytes + projectionBytes(projection);
  if (nextBytes <= output.maxBytes) {
    output.items.push(materializeProjection(projection));
    return { bytes: nextBytes, consumed: true, stop: false };
  }
  if (output.items.length === 0) {
    const fallbackBytes = oversizedProjectionBytes(projection);
    if (fallbackBytes > output.maxBytes) {
      throw new Error("The chat history item identity exceeds the read limit");
    }
    output.items.push(oversizedProjection(projection));
    return { bytes: fallbackBytes, consumed: true, stop: true };
  }
  return { bytes: output.previousBytes, consumed: false, stop: true };
}

/** Projects one message-summary turn page within raw-item and encoded-output bounds. */
export function collectGlobalSupervisorTurnHistoryItems(
  page: GlobalSupervisorTurnHistoryPage,
  request: { readonly initialOffset: number; readonly limit: number; readonly maxBytes: number },
): { readonly itemOffset: number; readonly items: readonly GlobalSupervisorChatItem[] } {
  const items: GlobalSupervisorChatItem[] = [];
  const sourceItems = page.turn?.items ?? [];
  let bytes = 0;
  let itemOffset = request.initialOffset;
  let inspected = 0;
  while (itemOffset < sourceItems.length && inspected < request.limit) {
    const projection = messageProjection(sourceItems[itemOffset]);
    inspected += 1;
    if (projection === null) {
      itemOffset += 1;
      continue;
    }
    const appended = appendProjection(projection, {
      items,
      maxBytes: request.maxBytes,
      previousBytes: bytes,
    });
    bytes = appended.bytes;
    if (appended.consumed) {
      itemOffset += 1;
    }
    if (appended.stop) {
      break;
    }
  }
  return { itemOffset, items };
}
