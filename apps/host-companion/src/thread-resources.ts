import path from "node:path";

import { fileMediaKind } from "@codewide/file-types";

import { compactInlineImagesInItem } from "./inline-image-projection.js";

type RpcObject = Record<string, unknown>;

export type ThreadChangeResource = {
  path: string;
  kind: "add" | "delete" | "update";
  additions: number;
  deletions: number;
  turnId: string;
  itemId: string;
};

export type ThreadAttachmentResource = {
  key: string;
  name: string;
  kind: "image" | "audio" | "file";
  path: string | null;
  url: string | null;
  origin: "user" | "agent";
  turnId: string;
  itemId: string;
};

export type ThreadResourcesSnapshot = {
  threadId: string;
  revision: string;
  changes: ThreadChangeResource[];
  attachments: ThreadAttachmentResource[];
};

export type ThreadChangePatch = {
  turnId: string;
  itemId: string;
  kind: ThreadChangeResource["kind"];
  diff: string;
};

export type ThreadChangeDiffSnapshot = {
  threadId: string;
  path: string;
  patches: ThreadChangePatch[];
  truncated: boolean;
};

const MAX_THREAD_CHANGE_DIFF_CHARS = 4 * 1024 * 1024;

type IndexedPatchBucket = {
  patches: ThreadChangePatch[];
  totalChars: number;
  truncated: boolean;
};

export type SerializedThreadResourceIndex = {
  version: 1;
  threadId: string;
  cwd: string | null;
  indexedTurnIds: string[];
  changes: ThreadChangeResource[];
  attachments: ThreadAttachmentResource[];
  patches: Array<{ path: string; patches: ThreadChangePatch[]; truncated: boolean }>;
};

/**
 * Compact append-only projection of immutable completed turns. The index owns
 * the expensive history-to-resources transformation so callers never need to
 * replay a complete rollout merely to paint Changes or open one diff.
 */
export class AppendOnlyThreadResourceIndex {
  readonly #threadId: string;
  readonly #cwd: string | null;
  readonly #indexedTurnIds = new Set<string>();
  readonly #changes = new Map<string, ThreadChangeResource>();
  readonly #attachments = new Map<string, ThreadAttachmentResource>();
  readonly #patchesByPath = new Map<string, IndexedPatchBucket>();
  readonly #liveTurns = new Map<string, AppendOnlyThreadResourceIndex>();
  #snapshot: ThreadResourcesSnapshot | null = null;

  constructor(threadId: string, cwd: string | null = null) {
    this.#threadId = threadId;
    this.#cwd = cwd;
  }

  static fromTurns(threadId: string, turns: readonly RpcObject[], cwd: string | null = null): AppendOnlyThreadResourceIndex {
    const index = new AppendOnlyThreadResourceIndex(threadId, cwd);
    for (const turn of turns) index.upsertTurn(turn);
    return index;
  }

  static restore(value: unknown): AppendOnlyThreadResourceIndex {
    const envelope = asObject(value);
    if (envelope?.version !== 1 || typeof envelope.threadId !== "string") throw new Error("thread resource index is invalid");
    const cwd = envelope.cwd === null || typeof envelope.cwd === "string" ? envelope.cwd : null;
    if (!Array.isArray(envelope.indexedTurnIds) || !Array.isArray(envelope.changes) || !Array.isArray(envelope.attachments) || !Array.isArray(envelope.patches)) {
      throw new Error("thread resource index is invalid");
    }
    const index = new AppendOnlyThreadResourceIndex(envelope.threadId, cwd);
    for (const turnId of envelope.indexedTurnIds) {
      if (typeof turnId !== "string" || turnId === "") throw new Error("thread resource index contains an invalid turn id");
      index.#indexedTurnIds.add(turnId);
    }
    for (const rawChange of envelope.changes) {
      const change = parseStoredChange(rawChange);
      index.#changes.set(change.path, change);
    }
    for (const rawAttachment of envelope.attachments) {
      const attachment = parseStoredAttachment(rawAttachment);
      index.#attachments.set(attachment.key, attachment);
    }
    for (const rawBucket of envelope.patches) {
      const bucket = asObject(rawBucket);
      if (bucket === null || typeof bucket.path !== "string" || !Array.isArray(bucket.patches)) throw new Error("thread resource index contains invalid patches");
      const patches = bucket.patches.map(parseStoredPatch);
      index.#patchesByPath.set(bucket.path, {
        patches,
        totalChars: patches.reduce((total, patch) => total + patch.diff.length, 0),
        truncated: bucket.truncated === true,
      });
    }
    return index;
  }

  appendCompletedTurn(rawTurn: RpcObject): boolean {
    const turnId = typeof rawTurn.id === "string" ? rawTurn.id : "";
    if (turnId === "" || rawTurn.status === "inProgress" || this.#indexedTurnIds.has(turnId)) return false;
    this.#liveTurns.delete(turnId);
    if (Array.isArray(rawTurn.items)) {
      for (const rawItem of rawTurn.items) this.#appendItem(turnId, rawItem);
    }
    this.#indexedTurnIds.add(turnId);
    this.#snapshot = null;
    return true;
  }

  upsertTurn(rawTurn: RpcObject): boolean {
    if (rawTurn.status !== "inProgress") return this.appendCompletedTurn(rawTurn);
    const turnId = typeof rawTurn.id === "string" ? rawTurn.id : "";
    if (turnId === "" || this.#indexedTurnIds.has(turnId)) return false;
    const overlay = new AppendOnlyThreadResourceIndex(this.#threadId, this.#cwd);
    overlay.appendCompletedTurn({ ...rawTurn, status: "completed" });
    this.#liveTurns.set(turnId, overlay);
    this.#snapshot = null;
    return true;
  }

  resources(): ThreadResourcesSnapshot {
    if (this.#snapshot !== null) return structuredClone(this.#snapshot);
    const changeMap = new Map(this.#changes);
    const attachmentMap = new Map(this.#attachments);
    for (const live of this.#liveTurns.values()) {
      const snapshot = live.resources();
      for (const change of snapshot.changes) {
        const previous = changeMap.get(change.path);
        changeMap.set(change.path, {
          ...change,
          additions: (previous?.additions ?? 0) + change.additions,
          deletions: (previous?.deletions ?? 0) + change.deletions,
        });
      }
      for (const attachment of snapshot.attachments) attachmentMap.set(attachment.key, attachment);
    }
    const changes = [...changeMap.values()].sort((left, right) => left.path.localeCompare(right.path));
    const attachments = [...attachmentMap.values()];
    this.#snapshot = {
      threadId: this.#threadId,
      revision: resourceRevision(changes, attachments),
      changes,
      attachments,
    };
    return structuredClone(this.#snapshot);
  }

  changeDiff(requestedPath: string): ThreadChangeDiffSnapshot {
    const resolvedPath = resolveResourcePath(requestedPath, this.#cwd);
    const bucket = this.#patchesByPath.get(resolvedPath);
    const patches = structuredClone(bucket?.patches ?? []);
    let totalChars = patches.reduce((total, patch) => total + patch.diff.length, 0);
    let truncated = bucket?.truncated ?? false;
    for (const live of this.#liveTurns.values()) {
      const liveDiff = live.changeDiff(resolvedPath);
      truncated = truncated || liveDiff.truncated;
      for (const patch of liveDiff.patches) {
        if (totalChars + patch.diff.length > MAX_THREAD_CHANGE_DIFF_CHARS) truncated = true;
        else {
          patches.push(patch);
          totalChars += patch.diff.length;
        }
      }
    }
    return {
      threadId: this.#threadId,
      path: resolvedPath,
      patches,
      truncated,
    };
  }

  serialize(): SerializedThreadResourceIndex {
    return {
      version: 1,
      threadId: this.#threadId,
      cwd: this.#cwd,
      indexedTurnIds: [...this.#indexedTurnIds],
      changes: [...this.#changes.values()],
      attachments: [...this.#attachments.values()],
      patches: [...this.#patchesByPath].map(([path, bucket]) => ({ path, patches: bucket.patches, truncated: bucket.truncated })),
    };
  }

  #appendItem(turnId: string, rawItem: unknown): void {
    const source = asObject(rawItem);
    if (source === null) return;
    const item = compactInlineImagesInItem(source);
    const itemId = typeof item.id === "string" ? item.id : "";
    if (item.type === "fileChange" && Array.isArray(item.changes)) {
      for (const rawChange of item.changes) this.#appendChange(turnId, itemId, rawChange);
    }
    if (item.type === "userMessage" && Array.isArray(item.content)) {
      for (const rawPart of item.content) {
        const part = asObject(rawPart);
        if (part?.type === "text" && typeof part.text === "string") {
          for (const attachment of mentionedFileAttachments(part.text, turnId, itemId, this.#cwd)) this.#attachments.set(attachment.key, attachment);
        }
        const attachment = part === null ? null : userAttachment(part, turnId, itemId, this.#cwd);
        if (attachment !== null) this.#attachments.set(attachment.key, attachment);
      }
    } else if (item.type === "imageView" && typeof item.path === "string") {
      const attachment = localAttachment(item.path, "image", "agent", turnId, itemId, undefined, this.#cwd);
      this.#attachments.set(attachment.key, attachment);
    } else if (item.type === "imageGeneration") {
      const savedPath = typeof item.savedPath === "string" ? item.savedPath : null;
      const result = typeof item.result === "string" ? item.result : null;
      const attachment = savedPath !== null
        ? localAttachment(savedPath, "image", "agent", turnId, itemId, undefined, this.#cwd)
        : result !== null && result !== "" ? remoteAttachment(result, "Generated image", "image", "agent", turnId, itemId) : null;
      if (attachment !== null) this.#attachments.set(attachment.key, attachment);
    }
  }

  #appendChange(turnId: string, itemId: string, rawChange: unknown): void {
    const change = asObject(rawChange);
    if (change === null || typeof change.path !== "string" || change.path === "") return;
    const kind = changeKind(change.kind);
    const sourcePath = movedPath(change.kind) ?? change.path;
    const resolvedPath = resolveResourcePath(sourcePath, this.#cwd);
    const diff = typeof change.diff === "string" ? change.diff : "";
    const stats = diffStats(diff);
    const previous = this.#changes.get(resolvedPath);
    this.#changes.set(resolvedPath, {
      path: resolvedPath,
      kind,
      additions: (previous?.additions ?? 0) + stats.additions,
      deletions: (previous?.deletions ?? 0) + stats.deletions,
      turnId,
      itemId,
    });
    if (diff === "") return;
    const bucket = this.#patchesByPath.get(resolvedPath) ?? { patches: [], totalChars: 0, truncated: false };
    if (bucket.totalChars + diff.length > MAX_THREAD_CHANGE_DIFF_CHARS) bucket.truncated = true;
    else {
      bucket.patches.push({ turnId, itemId, kind, diff });
      bucket.totalChars += diff.length;
    }
    this.#patchesByPath.set(resolvedPath, bucket);
  }
}

/**
 * Projects the complete host-side rollout into the tiny session resource index
 * consumed by Android. This belongs beside the history cache: paginated mobile
 * history is deliberately incomplete and must never be treated as the source
 * of truth for session-wide resources.
 */
export function projectThreadResources(threadId: string, turns: readonly RpcObject[], cwd: string | null = null): ThreadResourcesSnapshot {
  return AppendOnlyThreadResourceIndex.fromTurns(threadId, turns, cwd).resources();
}

/**
 * Reads the actual immutable file-change payload only when the review UI asks
 * for one file. Keeping patches out of the resource index prevents a large
 * thread from making the cheap sidebar query carry megabytes of diff text.
 */
export function projectThreadChangeDiff(
  threadId: string,
  turns: readonly RpcObject[],
  requestedPath: string,
  cwd: string | null = null,
): ThreadChangeDiffSnapshot {
  return AppendOnlyThreadResourceIndex.fromTurns(threadId, turns, cwd).changeDiff(requestedPath);
}

const FILES_HEADING = /^# Files mentioned by the user:\s*$/m;
const REQUEST_HEADING = /^## My request(?: for Codex)?:\s*$/m;
const FILE_ENTRY = /^##\s+(.+?):\s*(?:`([^`\n]+)`|([^\n]+))\s*$/gm;

function mentionedFileAttachments(text: string, turnId: string, itemId: string, cwd: string | null): ThreadAttachmentResource[] {
  const filesHeading = FILES_HEADING.exec(text);
  const requestHeading = REQUEST_HEADING.exec(text);
  if (filesHeading === null || requestHeading === null || filesHeading.index >= requestHeading.index) return [];
  const section = text.slice(filesHeading.index, requestHeading.index);
  FILE_ENTRY.lastIndex = 0;
  return [...section.matchAll(FILE_ENTRY)].flatMap((match) => {
    const name = match[1]?.trim();
    const filePath = (match[2] ?? match[3])?.trim();
    if (name === undefined || name === "" || filePath === undefined || filePath === "" || filePath.includes("\0")) return [];
    return [localAttachment(filePath, attachmentKind(name, filePath), "user", turnId, itemId, name, cwd)];
  });
}

function attachmentKind(name: string, filePath: string): ThreadAttachmentResource["kind"] {
  const kind = fileMediaKind(name) ?? fileMediaKind(filePath);
  if (kind !== null) return kind;
  return "file";
}

function userAttachment(part: RpcObject, turnId: string, itemId: string, cwd: string | null): ThreadAttachmentResource | null {
  if (part.type === "localImage" && typeof part.path === "string") return localAttachment(part.path, "image", "user", turnId, itemId, undefined, cwd);
  if (part.type === "localAudio" && typeof part.path === "string") return localAttachment(part.path, "audio", "user", turnId, itemId, undefined, cwd);
  if (part.type === "mention" && typeof part.path === "string") {
    return localAttachment(part.path, "file", "user", turnId, itemId, typeof part.name === "string" ? part.name : undefined, cwd);
  }
  if (part.type === "image" && typeof part.url === "string" && part.url !== "") return remoteAttachment(part.url, "Image", "image", "user", turnId, itemId);
  if (part.type === "audio" && typeof part.url === "string" && part.url !== "") return remoteAttachment(part.url, "Audio", "audio", "user", turnId, itemId);
  return null;
}

function localAttachment(
  filePath: string,
  kind: ThreadAttachmentResource["kind"],
  origin: ThreadAttachmentResource["origin"],
  turnId: string,
  itemId: string,
  name = path.basename(filePath) || "Attachment",
  cwd: string | null = null,
): ThreadAttachmentResource {
  const resolvedPath = resolveResourcePath(filePath, cwd);
  return { key: `path:${resolvedPath}`, name, kind, path: resolvedPath, url: null, origin, turnId, itemId };
}

function remoteAttachment(
  url: string,
  name: string,
  kind: ThreadAttachmentResource["kind"],
  origin: ThreadAttachmentResource["origin"],
  turnId: string,
  itemId: string,
): ThreadAttachmentResource {
  return { key: `url:${url}`, name, kind, path: null, url, origin, turnId, itemId };
}

function changeKind(value: unknown): ThreadChangeResource["kind"] {
  if (typeof value === "string" && (value === "add" || value === "delete" || value === "update")) return value;
  const object = asObject(value);
  return object?.type === "add" || object?.type === "delete" ? object.type : "update";
}

function movedPath(value: unknown): string | null {
  const object = asObject(value);
  return object?.type === "update" && typeof object.move_path === "string" && object.move_path !== ""
    ? object.move_path
    : null;
}

function resolveResourcePath(value: string, cwd: string | null): string {
  return path.isAbsolute(value) || cwd === null ? path.normalize(value) : path.resolve(cwd, value);
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function resourceRevision(changes: readonly ThreadChangeResource[], attachments: readonly ThreadAttachmentResource[]): string {
  let hash = 2_166_136_261;
  const value = JSON.stringify([changes, attachments]);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function parseStoredChange(value: unknown): ThreadChangeResource {
  const change = asObject(value);
  if (
    change === null || typeof change.path !== "string" ||
    (change.kind !== "add" && change.kind !== "delete" && change.kind !== "update") ||
    typeof change.additions !== "number" || typeof change.deletions !== "number" ||
    typeof change.turnId !== "string" || typeof change.itemId !== "string"
  ) throw new Error("thread resource index contains an invalid change");
  return change as ThreadChangeResource;
}

function parseStoredAttachment(value: unknown): ThreadAttachmentResource {
  const attachment = asObject(value);
  if (
    attachment === null || typeof attachment.key !== "string" || typeof attachment.name !== "string" ||
    (attachment.kind !== "image" && attachment.kind !== "audio" && attachment.kind !== "file") ||
    (attachment.path !== null && typeof attachment.path !== "string") ||
    (attachment.url !== null && typeof attachment.url !== "string") ||
    (attachment.origin !== "user" && attachment.origin !== "agent") ||
    typeof attachment.turnId !== "string" || typeof attachment.itemId !== "string"
  ) throw new Error("thread resource index contains an invalid attachment");
  return attachment as ThreadAttachmentResource;
}

function parseStoredPatch(value: unknown): ThreadChangePatch {
  const patch = asObject(value);
  if (
    patch === null || typeof patch.turnId !== "string" || typeof patch.itemId !== "string" ||
    (patch.kind !== "add" && patch.kind !== "delete" && patch.kind !== "update") || typeof patch.diff !== "string"
  ) throw new Error("thread resource index contains an invalid patch");
  return patch as ThreadChangePatch;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}
