import type { PrivateContentReference, PrivateContentService } from "./private-content.js";
import { compactInlineImagesInItem, compactInlineImagesInNotification, compactInlineImagesInTurn } from "./inline-image-projection.js";

type RpcObject = Record<string, unknown>;

export type ContentProjectionMetadata = {
  version: 1;
  fields: Record<string, PrivateContentReference>;
  whole?: PrivateContentReference;
};

export const MAX_INLINE_TEXT_BYTES = 16 * 1024;
export const MAX_PROJECTED_ITEM_BYTES = 32 * 1024;
export const MAX_PROJECTED_TURN_BYTES = 96 * 1024;
export const MAX_PROJECTED_PAGE_BYTES = 256 * 1024;
export const MAX_PROJECTED_NOTIFICATION_BYTES = 96 * 1024;
const MAX_COLLECTION_ENTRIES = 128;

/** Moves heavy transcript fields out of the synchronization and render lanes. */
export class ContentProjector {
  readonly #content: PrivateContentService;

  constructor(content: PrivateContentService) {
    this.#content = content;
  }

  projectItem(rawItem: RpcObject): RpcObject {
    const item = compactInlineImagesInItem(rawItem, this.#content);
    const fields: Record<string, PrivateContentReference> = {};
    const projected = this.#projectValue(item, "", fields, 0) as RpcObject;
    if (Buffer.byteLength(JSON.stringify(projected)) <= MAX_PROJECTED_ITEM_BYTES) {
      return attachMetadata(projected, fields);
    }
    const whole = this.#content.putJson(item);
    const minimal = minimalItem(item, (value, pointer) => this.#projectString(value, pointer, fields));
    return attachMetadata(minimal, fields, whole);
  }

  projectTurn(rawTurn: RpcObject): RpcObject {
    const turn = compactInlineImagesInTurn(rawTurn, this.#content);
    if (!Array.isArray(turn.items)) return turn;
    const { items, ...turnFields } = turn;
    const fields: Record<string, PrivateContentReference> = {};
    const projectedFields = this.#projectValue(turnFields, "", fields, 0) as RpcObject;
    const projectedItems = items.map((value) => {
      const item = asObject(value);
      return item === null ? value : this.projectItem(item);
    });
    const projected = attachMetadata({ ...projectedFields, items: projectedItems }, fields);
    if (Buffer.byteLength(JSON.stringify(projected)) <= MAX_PROJECTED_TURN_BYTES) return projected;
    const whole = this.#content.putJson(turn);
    const summaryItems = summarizeTurnItems(projectedItems);
    const summary = attachMetadata(withActivitySummary({ ...projectedFields, items: summaryItems, itemsView: "summary" }, projectedItems), fields, whole);
    if (Buffer.byteLength(JSON.stringify(summary)) <= MAX_PROJECTED_TURN_BYTES) return summary;
    return attachMetadata(withActivitySummary({ ...scalarFields(turn), items: summaryItems, itemsView: "summary" }, projectedItems), {}, whole);
  }

  projectThread(rawThread: RpcObject): RpcObject {
    if (!Array.isArray(rawThread.turns)) return rawThread;
    const { turns, ...threadFields } = rawThread;
    const fields: Record<string, PrivateContentReference> = {};
    const projectedFields = this.#projectValue(threadFields, "", fields, 0) as RpcObject;
    const projectedTurns = turns.map((rawTurn) => {
      const turn = asObject(rawTurn);
      return turn === null ? rawTurn : this.projectTurn(turn);
    });
    const projected = attachMetadata({ ...projectedFields, turns: projectedTurns }, fields);
    if (Buffer.byteLength(JSON.stringify(projected)) <= MAX_PROJECTED_PAGE_BYTES) return projected;
    const whole = this.#content.putJson(rawThread);
    const retained: unknown[] = [];
    let bytes = Buffer.byteLength(JSON.stringify(projectedFields));
    for (let index = projectedTurns.length - 1; index >= 0; index -= 1) {
      const turn = projectedTurns[index];
      const turnBytes = Buffer.byteLength(JSON.stringify(turn)) + 1;
      if (retained.length > 0 && bytes + turnBytes > MAX_PROJECTED_PAGE_BYTES) break;
      retained.unshift(turn);
      bytes += turnBytes;
    }
    const bounded = attachMetadata({ ...projectedFields, turns: retained }, fields, whole);
    if (Buffer.byteLength(JSON.stringify(bounded)) <= MAX_PROJECTED_PAGE_BYTES) return bounded;
    return attachMetadata({ ...scalarFields(rawThread), turns: retained.slice(-1) }, {}, whole);
  }

  projectNotification(method: string, payload: unknown): unknown {
    const compacted = compactInlineImagesInNotification(method, payload, this.#content);
    const params = asObject(compacted);
    if (params === null) return compacted;
    if (method === "turn/started" || method === "turn/completed") {
      const turn = asObject(params.turn);
      return turn === null ? compacted : { ...params, turn: this.projectTurn(turn) };
    }
    if (method === "item/started" || method === "item/completed") {
      const item = asObject(params.item);
      return item === null ? compacted : { ...params, item: this.projectItem(item) };
    }
    if (method === "thread/started") {
      const thread = asObject(params.thread);
      if (thread === null) return compacted;
      return { ...params, thread: this.projectThread(thread) };
    }
    const fields: Record<string, PrivateContentReference> = {};
    const projected = this.#projectValue(params, "", fields, 0) as RpcObject;
    const attached = attachMetadata(projected, fields);
    if (Buffer.byteLength(JSON.stringify(attached)) <= MAX_PROJECTED_NOTIFICATION_BYTES) return attached;
    return attachMetadata(scalarFields(params), {}, this.#content.putJson(params));
  }

  projectRpcResult(method: string, value: unknown): unknown {
    const result = asObject(value);
    if (result === null) return value;
    if (method === "thread/read" || method === "thread/resume") {
      const thread = asObject(result.thread);
      if (thread === null) return result;
      return { ...result, thread: this.projectThread(thread) };
    }
    if (method === "thread/turns/list" && Array.isArray(result.data)) {
      return { ...result, data: result.data.map((rawTurn) => {
        const turn = asObject(rawTurn);
        return turn === null ? rawTurn : this.projectTurn(turn);
      }) };
    }
    if (method === "thread/items/list" && Array.isArray(result.data)) {
      return { ...result, data: result.data.map((rawEntry) => {
        const entry = asObject(rawEntry);
        const item = asObject(entry?.item);
        return entry === null || item === null ? rawEntry : { ...entry, item: this.projectItem(item) };
      }) };
    }
    return value;
  }

  #projectValue(value: unknown, pointer: string, fields: Record<string, PrivateContentReference>, depth: number): unknown {
    if (typeof value === "string") return this.#projectString(value, pointer || "/", fields);
    if (value === null || typeof value !== "object") return value;
    if (depth >= 16) {
      fields[pointer || "/"] = this.#content.putJson(value);
      return Array.isArray(value) ? [] : {};
    }
    if (Array.isArray(value)) {
      const values = value.length > MAX_COLLECTION_ENTRIES ? value.slice(0, MAX_COLLECTION_ENTRIES) : value;
      if (values.length !== value.length) fields[pointer || "/"] = this.#content.putJson(value);
      return values.map((child, index) => this.#projectValue(child, `${pointer}/${index}`, fields, depth + 1));
    }
    const object = value as RpcObject;
    const entries = Object.entries(object);
    const selected = entries.length > MAX_COLLECTION_ENTRIES ? entries.slice(0, MAX_COLLECTION_ENTRIES) : entries;
    if (selected.length !== entries.length) fields[pointer || "/"] = this.#content.putJson(value);
    return Object.fromEntries(selected.map(([key, child]) => [key, this.#projectValue(child, `${pointer}/${escapePointer(key)}`, fields, depth + 1)]));
  }

  #projectString(value: string, pointer: string, fields: Record<string, PrivateContentReference>): string {
    const bytes = Buffer.byteLength(value);
    if (bytes <= MAX_INLINE_TEXT_BYTES) return value;
    fields[pointer] = this.#content.putText(value, contentTypeForPointer(pointer));
    return boundedTextPreview(value, MAX_INLINE_TEXT_BYTES, bytes);
  }
}

export function takeProjectedPage<T>(
  values: readonly T[],
  offset: number,
  limit: number,
  project: (value: T) => unknown,
): { data: unknown[]; consumed: number } {
  const data: unknown[] = [];
  let bytes = 2;
  for (const value of values.slice(offset, offset + limit)) {
    const projected = project(value);
    const projectedBytes = Buffer.byteLength(JSON.stringify(projected)) + 1;
    if (data.length > 0 && bytes + projectedBytes > MAX_PROJECTED_PAGE_BYTES) break;
    data.push(projected);
    bytes += projectedBytes;
  }
  return { data, consumed: data.length };
}

function minimalItem(item: RpcObject, projectString: (value: string, pointer: string) => string): RpcObject {
  const base = Object.fromEntries(Object.entries(item).filter(([, value]) => value === null || typeof value === "number" || typeof value === "boolean"));
  if (typeof item.id === "string") base.id = item.id;
  if (typeof item.type === "string") base.type = item.type;
  if (typeof item.status === "string") base.status = item.status;
  if (typeof item.command === "string") base.command = projectString(item.command, "/command");
  if (typeof item.text === "string") base.text = projectString(item.text, "/text");
  if (typeof item.aggregatedOutput === "string") base.aggregatedOutput = projectString(item.aggregatedOutput, "/aggregatedOutput");
  if (Array.isArray(item.content)) base.content = item.content.slice(0, 16).map((part, index) => {
    const object = asObject(part);
    if (object === null) return part;
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === "string" ? projectString(value, `/content/${index}/${escapePointer(key)}`) : value]));
  });
  if (Array.isArray(item.changes)) base.changes = item.changes.slice(0, 8).map((change, index) => {
    const object = asObject(change);
    if (object === null) return change;
    return {
      ...(typeof object.path === "string" ? { path: projectString(object.path, `/changes/${index}/path`) } : {}),
      ...projectPatchChangeKind(object.kind),
      ...(typeof object.diff === "string" ? { diff: projectString(object.diff, `/changes/${index}/diff`) } : {}),
    };
  });
  return base;
}

function projectPatchChangeKind(value: unknown): { kind?: unknown } {
  if (typeof value === "string") return { kind: value };
  const object = asObject(value);
  if (object === null || !["add", "delete", "update"].includes(String(object.type))) return {};
  return {
    kind: object.type === "update"
      ? { type: "update", move_path: typeof object.move_path === "string" ? object.move_path : null }
      : { type: object.type },
  };
}

function summarizeTurnItems(items: unknown[]): unknown[] {
  const firstUserIndex = items.findIndex((value) => asObject(value)?.type === "userMessage");
  let finalAgentIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (asObject(items[index])?.type === "agentMessage") {
      finalAgentIndex = index;
      break;
    }
  }
  const indexes = [...new Set([firstUserIndex, finalAgentIndex].filter((index) => index >= 0))];
  return indexes.map((index) => items[index]);
}

function withActivitySummary(turn: RpcObject, items: unknown[]): RpcObject {
  const finalAgentIndex = findFinalAgentIndex(items);
  const kinds = items.flatMap((value, index) => {
    const type = asObject(value)?.type;
    return typeof type !== "string" || type === "userMessage" || index === finalAgentIndex ? [] : [type];
  });
  if (kinds.length === 0) return turn;
  const existing = asObject(turn.codewide) ?? {};
  return { ...turn, codewide: { ...existing, activity: { count: kinds.length, kinds } } };
}

function findFinalAgentIndex(items: unknown[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (asObject(items[index])?.type === "agentMessage") return index;
  }
  return -1;
}

function scalarFields(value: RpcObject): RpcObject {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => (
    child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean"
  )));
}

function attachMetadata(item: RpcObject, fields: Record<string, PrivateContentReference>, whole?: PrivateContentReference): RpcObject {
  if (Object.keys(fields).length === 0 && whole === undefined) return item;
  return {
    ...item,
    codewideContent: {
      version: 1,
      fields,
      ...(whole === undefined ? {} : { whole }),
    } satisfies ContentProjectionMetadata,
  };
}

function boundedTextPreview(value: string, maxBytes: number, originalBytes: number): string {
  const marker = `\n… [${originalBytes.toLocaleString("en-US")} bytes; full content available]`;
  const markerBytes = Buffer.byteLength(marker);
  const headBudget = Math.max(0, Math.floor((maxBytes - markerBytes) * 0.75));
  const tailBudget = Math.max(0, maxBytes - markerBytes - headBudget);
  return `${utf8Prefix(value, headBudget)}${marker}${utf8Suffix(value, tailBudget)}`;
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

function utf8Suffix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(value.length - middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(value.length - low);
}

function contentTypeForPointer(pointer: string): string {
  if (pointer.endsWith("/diff") || pointer === "/diff") return "text/x-diff; charset=utf-8";
  if (pointer.endsWith("/aggregatedOutput") || pointer === "/aggregatedOutput") return "text/x-ansi; charset=utf-8";
  if (pointer.endsWith("/text") || pointer.includes("/content/")) return "text/markdown; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}
