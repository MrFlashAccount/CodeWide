import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { DeviceScope } from "./capabilities.js";

const CONTENT_PREFIX = "/v1/content/";
const REQUIRED_SCOPE: DeviceScope = "files.download.workspace";
const MAX_CHUNK_BYTES = 256 * 1024;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const MAX_DISK_BYTES = 1024 * 1024 * 1024;
const PRUNE_INTERVAL_MS = 10_000;

export type PrivateContentReference = {
  id: string;
  byteLength: number;
  contentType: string;
  encoding: "utf-8";
};

export type PrivateAssetReference = {
  id: string;
  byteLength: number;
  contentType: string;
};

type CachedContent = { bytes: Buffer; contentType: string; lastAccessAt: number };

/**
 * Content-addressed, private storage for transcript bodies which are too large
 * for the timeline lane. References are harmless without a scoped session
 * credential and never expose a host path.
 */
export class PrivateContentService {
  readonly #directory: string;
  readonly #authorize: (authorization: string | undefined, requiredScope: DeviceScope) => boolean;
  readonly #memory = new Map<string, CachedContent>();
  readonly #writes = new Set<Promise<void>>();
  readonly #writesById = new Map<string, Promise<void>>();
  #memoryBytes = 0;
  #lastPruneAt = 0;
  #prune: Promise<void> = Promise.resolve();

  constructor(directory: string, authorize: (authorization: string | undefined, requiredScope: DeviceScope) => boolean) {
    this.#directory = directory;
    this.#authorize = authorize;
  }

  putText(value: string, contentType = "text/plain; charset=utf-8"): PrivateContentReference {
    const bytes = Buffer.from(value, "utf8");
    return { ...this.putBytes(bytes, contentType), encoding: "utf-8" };
  }

  putBytes(bytes: Buffer, contentType: string): PrivateAssetReference {
    const id = createHash("sha256").update(bytes).digest("hex");
    this.#remember(id, bytes, contentType);
    if (this.#writesById.has(id)) return { id, byteLength: bytes.byteLength, contentType };
    const write = this.#persist(id, bytes, contentType)
      .catch((cause) => console.warn(JSON.stringify({
        status: "private-content-persist-failed",
        id,
        error: cause instanceof Error ? cause.message : "unknown",
      })))
      .finally(() => {
        this.#writes.delete(write);
        if (this.#writesById.get(id) === write) this.#writesById.delete(id);
      });
    this.#writes.add(write);
    this.#writesById.set(id, write);
    return { id, byteLength: bytes.byteLength, contentType };
  }

  putJson(value: unknown): PrivateContentReference {
    return this.putText(JSON.stringify(value), "application/json; charset=utf-8");
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(CONTENT_PREFIX)) return false;
    if (!this.#authorize(request.headers.authorization, REQUIRED_SCOPE) || request.headers.origin !== undefined) {
      json(response, 401, { error: "unauthorized" });
      return true;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "method_not_allowed" });
      return true;
    }
    const id = requestUrl.pathname.slice(CONTENT_PREFIX.length);
    if (!/^[a-f0-9]{64}$/.test(id)) {
      json(response, 404, { error: "content_not_found" });
      return true;
    }
    const content = await this.#load(id);
    if (content === null) {
      json(response, 404, { error: "content_not_found" });
      return true;
    }
    let range = requestedRange(request, requestUrl, content.bytes.byteLength);
    if (range === null) {
      response.writeHead(416, { "content-range": `bytes */${content.bytes.byteLength}` });
      response.end();
      return true;
    }
    if (content.contentType.includes("charset=utf-8")) range = alignUtf8Range(content.bytes, range);
    const body = content.bytes.subarray(range.start, range.endExclusive);
    response.writeHead(range.partial ? 206 : 200, {
      "content-type": content.contentType,
      "content-length": String(body.byteLength),
      "accept-ranges": "bytes",
      "content-range": `bytes ${range.start}-${Math.max(range.start, range.endExclusive - 1)}/${content.bytes.byteLength}`,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  }

  async close(): Promise<void> {
    await Promise.all(this.#writes);
    await this.#prune;
    this.#memory.clear();
    this.#memoryBytes = 0;
  }

  async #persist(id: string, bytes: Buffer, contentType: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const target = this.#path(id);
    const metadataTarget = `${target}.meta.json`;
    const existing = await stat(target).catch(() => null);
    if (existing?.size === bytes.byteLength) {
      this.#schedulePrune();
      return;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporary, target).catch(async (cause: NodeJS.ErrnoException) => {
        if (cause.code !== "EEXIST") throw cause;
      });
      await writeFile(metadataTarget, JSON.stringify({ contentType }), { mode: 0o600 });
      this.#schedulePrune();
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #load(id: string): Promise<CachedContent | null> {
    const cached = this.#memory.get(id);
    if (cached !== undefined) {
      cached.lastAccessAt = Date.now();
      return cached;
    }
    try {
      const [bytes, rawMetadata] = await Promise.all([
        readFile(this.#path(id)),
        readFile(`${this.#path(id)}.meta.json`, "utf8").catch(() => "{}"),
      ]);
      const metadata = JSON.parse(rawMetadata) as { contentType?: unknown };
      const contentType = typeof metadata.contentType === "string" ? metadata.contentType : "text/plain; charset=utf-8";
      this.#remember(id, bytes, contentType);
      return this.#memory.get(id) ?? null;
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === "ENOENT" ? null : Promise.reject(cause);
    }
  }

  #remember(id: string, bytes: Buffer, contentType: string): void {
    const existing = this.#memory.get(id);
    if (existing !== undefined) {
      existing.lastAccessAt = Date.now();
      return;
    }
    if (bytes.byteLength > MAX_MEMORY_BYTES) return;
    while (this.#memoryBytes + bytes.byteLength > MAX_MEMORY_BYTES) {
      const oldest = [...this.#memory.entries()].sort((left, right) => left[1].lastAccessAt - right[1].lastAccessAt)[0];
      if (oldest === undefined) break;
      this.#memory.delete(oldest[0]);
      this.#memoryBytes -= oldest[1].bytes.byteLength;
    }
    this.#memory.set(id, { bytes, contentType, lastAccessAt: Date.now() });
    this.#memoryBytes += bytes.byteLength;
  }

  #path(id: string): string {
    return path.join(this.#directory, id);
  }

  #schedulePrune(): void {
    const now = Date.now();
    if (now - this.#lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.#lastPruneAt = now;
    this.#prune = this.#prune.then(async () => {
      const names = await readdir(this.#directory).catch(() => []);
      const contents = await Promise.all(names.filter((name) => /^[a-f0-9]{64}$/.test(name)).map(async (id) => {
        const info = await stat(this.#path(id));
        return { id, bytes: info.size, touchedAt: info.mtimeMs };
      }));
      let total = contents.reduce((sum, entry) => sum + entry.bytes, 0);
      for (const entry of contents.sort((left, right) => left.touchedAt - right.touchedAt)) {
        if (total <= MAX_DISK_BYTES) break;
        await Promise.all([
          rm(this.#path(entry.id), { force: true }),
          rm(`${this.#path(entry.id)}.meta.json`, { force: true }),
        ]);
        const cached = this.#memory.get(entry.id);
        if (cached !== undefined) {
          this.#memory.delete(entry.id);
          this.#memoryBytes -= cached.bytes.byteLength;
        }
        total -= entry.bytes;
      }
    }).catch((cause) => console.warn(JSON.stringify({
      status: "private-content-prune-failed",
      error: cause instanceof Error ? cause.message : "unknown",
    })));
  }
}

function requestedRange(
  request: IncomingMessage,
  requestUrl: URL,
  total: number,
): { start: number; endExclusive: number; partial: boolean } | null {
  const queryOffset = requestUrl.searchParams.get("offset");
  const queryLimit = requestUrl.searchParams.get("limit");
  const rangeHeader = request.headers.range;
  let start = 0;
  let requestedEnd = total;
  let partial = false;
  if (rangeHeader !== undefined) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (match === null) return null;
    start = Number(match[1]);
    requestedEnd = match[2] === "" ? total : Number(match[2]) + 1;
    partial = true;
  } else if (queryOffset !== null || queryLimit !== null) {
    start = Number(queryOffset ?? "0");
    requestedEnd = start + Number(queryLimit ?? String(MAX_CHUNK_BYTES));
    partial = true;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd <= start || start >= total) return null;
  const endExclusive = Math.min(total, requestedEnd, start + MAX_CHUNK_BYTES);
  return { start, endExclusive, partial: partial || start !== 0 || endExclusive !== total };
}

function alignUtf8Range(
  bytes: Buffer,
  range: { start: number; endExclusive: number; partial: boolean },
): { start: number; endExclusive: number; partial: boolean } {
  let start = range.start;
  let endExclusive = range.endExclusive;
  while (start < endExclusive && start > 0 && isUtf8Continuation(bytes[start]!)) start += 1;
  while (endExclusive < bytes.byteLength && isUtf8Continuation(bytes[endExclusive]!)) endExclusive += 1;
  return { ...range, start, endExclusive };
}

function isUtf8Continuation(byte: number): boolean {
  return (byte & 0b1100_0000) === 0b1000_0000;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}
