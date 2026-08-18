import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { WebSocket } from "ws";

import type { LocalRpcHandler } from "./dictation.js";
import { compactInlineImagesInItem } from "./inline-image-projection.js";
import { ContentProjector, takeProjectedPage } from "./content-projection.js";
import { AppendOnlyThreadResourceIndex, type ThreadResourcesSnapshot } from "./thread-resources.js";

type RpcObject = Record<string, unknown>;
type CachedTurn = RpcObject & { id: string; items: RpcObject[] };
type CacheEntry = { turns: CachedTurn[]; cwd: string | null; bytes: number; touchedAt: number; recencyAt: number | null; dirtyFromEvents: boolean };
type ResourceCacheEntry = { index: AppendOnlyThreadResourceIndex; touchedAt: number; recencyAt: number | null; dirtyFromEvents: boolean };

export type LegacyHistoryCacheOptions = {
  connectUpstream(): WebSocket;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  requestTimeoutMs?: number;
  cacheDirectory?: string;
  maxDiskBytes?: number;
  contentProjector?: ContentProjector;
};

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_DISK_BYTES = 512 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CURSOR_PREFIX = "codewide-history-v1:";
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Indexes legacy JSONL histories once on the host. Codex' legacy
 * thread/turns/list implementation reconstructs the complete rollout for
 * every page; serving immutable pages from this bounded LRU removes that O(N)
 * replay from pagination and makes turn activity addressable by turn id.
 */
export class LegacyHistoryCache implements LocalRpcHandler {
  readonly #connectUpstream: () => WebSocket;
  readonly #maxEntryBytes: number;
  readonly #maxTotalBytes: number;
  readonly #requestTimeoutMs: number;
  readonly #cacheDirectory: string | undefined;
  readonly #maxDiskBytes: number;
  readonly #contentProjector: ContentProjector | undefined;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #observedTurns = new Map<string, Map<string, CachedTurn>>();
  readonly #liveResourceTurns = new Map<string, Map<string, CachedTurn>>();
  readonly #loading = new Map<string, Promise<CacheEntry>>();
  readonly #resourceEntries = new Map<string, ResourceCacheEntry>();
  readonly #resourceLoading = new Map<string, Promise<ResourceCacheEntry>>();
  readonly #resourceRefreshing = new Map<string, Promise<void>>();
  readonly #resourcePersistChains = new Map<string, Promise<void>>();
  readonly #resourceGenerations = new Map<string, number>();
  readonly #persisting = new Set<Promise<void>>();
  #totalBytes = 0;
  #closed = false;

  constructor(options: LegacyHistoryCacheOptions) {
    this.#connectUpstream = options.connectUpstream;
    this.#maxEntryBytes = positiveInteger(options.maxEntryBytes ?? MAX_ENTRY_BYTES, "maxEntryBytes");
    this.#maxTotalBytes = positiveInteger(options.maxTotalBytes ?? MAX_TOTAL_BYTES, "maxTotalBytes");
    this.#requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, "requestTimeoutMs");
    this.#cacheDirectory = options.cacheDirectory;
    this.#maxDiskBytes = positiveInteger(options.maxDiskBytes ?? MAX_DISK_BYTES, "maxDiskBytes");
    this.#contentProjector = options.contentProjector;
  }

  handles(method: string): boolean {
    return method === "thread/turns/list"
      || method === "thread/items/list"
      || method === "companion/threadResources/read"
      || method === "companion/threadChange/read";
  }

  async handle(_clientId: string, method: string, params: RpcObject): Promise<unknown> {
    if (this.#closed) throw new Error("History cache is shutting down");
    const threadId = requiredString(params.threadId, "threadId");
    const expectedRecencyAt = finiteNumber(params.expectedRecencyAt);
    if (method === "companion/threadResources/read" || method === "companion/threadChange/read") {
      const resourceEntry = await this.#resourceEntry(threadId, expectedRecencyAt);
      if (method === "companion/threadResources/read") return await withCurrentChangeAvailability(resourceEntry.index.resources());
      return resourceEntry.index.changeDiff(requiredString(params.path, "path"));
    }
    let entry = await this.#entry(threadId, expectedRecencyAt);
    if (method === "thread/turns/list") return turnsPage(threadId, entry.turns, params, this.#contentProjector);
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    if (turnId !== null && !entry.turns.some((turn) => turn.id === turnId)) {
      // The cache may have been built while this turn was still running. One
      // targeted miss refreshes it; ordinary live deltas never evict the large
      // immutable history index.
      this.#invalidateHistory(threadId);
      entry = await this.#entry(threadId, expectedRecencyAt);
    }
    return itemsPage(threadId, entry.turns, params, this.#contentProjector);
  }

  observe(method: string, payload: unknown): void {
    const params = asObject(payload);
    if (params === null || typeof params.threadId !== "string") return;
    const threadId = params.threadId;
    if (method === "thread/compacted" || method === "thread/deleted") {
      this.#observedTurns.delete(threadId);
      this.#liveResourceTurns.delete(threadId);
      this.invalidate(threadId);
      return;
    }
    if (method !== "turn/started" && method !== "turn/completed") {
      this.#observeResourceItemEvent(threadId, method, params);
      return;
    }
    const rawTurn = asObject(params?.turn);
    if (rawTurn === null) return;
    let turn: CachedTurn;
    try {
      turn = parseTurn(rawTurn);
    } catch {
      return;
    }
    const observed = this.#observedTurns.get(threadId) ?? new Map<string, CachedTurn>();
    observed.set(turn.id, preferRicherTurn(observed.get(turn.id), turn));
    this.#observedTurns.delete(threadId);
    this.#observedTurns.set(threadId, observed);
    while (observed.size > 256) observed.delete(observed.keys().next().value as string);
    while (this.#observedTurns.size > 64) this.#observedTurns.delete(this.#observedTurns.keys().next().value as string);
    const entry = this.#entries.get(threadId);
    if (entry !== undefined) mergeObservedTurns(entry, observed);
    if (method === "turn/started") this.#upsertLiveResourceTurn(threadId, turn);
    else {
      this.#liveResourceTurns.get(threadId)?.delete(turn.id);
      this.#appendResourceTurn(threadId, turn);
    }
  }

  releaseClient(_clientId: string): void {}

  close(): void {
    this.#closed = true;
    this.#entries.clear();
    this.#resourceEntries.clear();
    this.#observedTurns.clear();
    this.#liveResourceTurns.clear();
    this.#loading.clear();
    this.#resourceLoading.clear();
    this.#resourceRefreshing.clear();
    this.#resourcePersistChains.clear();
    this.#resourceGenerations.clear();
    this.#totalBytes = 0;
  }

  async flush(): Promise<void> {
    await Promise.all(this.#persisting);
  }

  invalidate(threadId: string): void {
    this.#invalidateHistory(threadId);
    this.#resourceGenerations.set(threadId, this.#resourceGeneration(threadId) + 1);
    this.#resourceEntries.delete(threadId);
    this.#resourceLoading.delete(threadId);
    if (this.#cacheDirectory !== undefined) void rm(this.#resourceCachePath(threadId), { force: true });
  }

  #invalidateHistory(threadId: string): void {
    const previous = this.#entries.get(threadId);
    if (previous !== undefined) {
      this.#entries.delete(threadId);
      this.#totalBytes = Math.max(0, this.#totalBytes - previous.bytes);
    }
    if (this.#cacheDirectory !== undefined) void rm(this.#cachePath(threadId), { force: true });
  }

  async #entry(threadId: string, expectedRecencyAt: number | null = null): Promise<CacheEntry> {
    let forceRefresh = false;
    const cached = this.#entries.get(threadId);
    if (cached !== undefined) {
      if (expectedRecencyAt === null || cached.recencyAt === expectedRecencyAt) {
        cached.touchedAt = Date.now();
        return cached;
      }
      if (cached.dirtyFromEvents) {
        // Sync notifications already advanced this in-memory index. Accept the
        // resume metadata as the matching recency and persist in the
        // background instead of replaying a 10-30 MB rollout synchronously.
        cached.recencyAt = expectedRecencyAt;
        cached.dirtyFromEvents = false;
        cached.touchedAt = Date.now();
        this.#schedulePersist(threadId, cached);
        return cached;
      }
      this.#invalidateHistory(threadId);
      forceRefresh = true;
    }
    const existing = this.#loading.get(threadId);
    if (existing !== undefined) return await existing;
    const loading = (forceRefresh ? this.#load(threadId) : this.#loadPersisted(threadId)
      .then(async (persisted) => {
        if (persisted !== null && (expectedRecencyAt === null || persisted.recencyAt === expectedRecencyAt || persisted.dirtyFromEvents)) {
          if (persisted.dirtyFromEvents && expectedRecencyAt !== null) {
            persisted.recencyAt = expectedRecencyAt;
            persisted.dirtyFromEvents = false;
            this.#schedulePersist(threadId, persisted);
          }
          return persisted;
        }
        if (persisted !== null) this.#invalidateHistory(threadId);
        return await this.#load(threadId);
      }))
      .finally(() => this.#loading.delete(threadId));
    this.#loading.set(threadId, loading);
    return await loading;
  }

  async #resourceEntry(threadId: string, expectedRecencyAt: number | null): Promise<ResourceCacheEntry> {
    const cached = this.#resourceEntries.get(threadId);
    if (cached !== undefined) return this.#acceptResourceRecency(threadId, cached, expectedRecencyAt);
    const existing = this.#resourceLoading.get(threadId);
    if (existing !== undefined) return this.#acceptResourceRecency(threadId, await existing, expectedRecencyAt);
    const loading = this.#loadPersistedResource(threadId)
      .then(async (persisted) => {
        let entry = persisted;
        if (entry === null) {
          // Reuse a persisted history entry when available. This is the sole
          // cold bootstrap; subsequent resource reads use the compact index.
          const history = await this.#entry(threadId, null);
          entry = {
            index: AppendOnlyThreadResourceIndex.fromTurns(threadId, history.turns, history.cwd),
            touchedAt: Date.now(),
            recencyAt: history.recencyAt,
            dirtyFromEvents: false,
          };
          this.#scheduleResourcePersist(threadId, entry);
        }
        if (mergeObservedResourceTurns(entry, this.#observedTurns.get(threadId))) entry.dirtyFromEvents = true;
        mergeLiveResourceTurns(entry, this.#liveResourceTurns.get(threadId));
        this.#resourceEntries.set(threadId, entry);
        return entry;
      })
      .finally(() => this.#resourceLoading.delete(threadId));
    this.#resourceLoading.set(threadId, loading);
    return this.#acceptResourceRecency(threadId, await loading, expectedRecencyAt);
  }

  #acceptResourceRecency(threadId: string, entry: ResourceCacheEntry, expectedRecencyAt: number | null): ResourceCacheEntry {
    entry.touchedAt = Date.now();
    if (expectedRecencyAt === null || entry.recencyAt === expectedRecencyAt) return entry;
    if (entry.dirtyFromEvents) {
      entry.recencyAt = expectedRecencyAt;
      entry.dirtyFromEvents = false;
      this.#scheduleResourcePersist(threadId, entry);
      return entry;
    }
    if ((this.#liveResourceTurns.get(threadId)?.size ?? 0) > 0) return entry;
    // A recency mismatch without an observed completed turn is a possible
    // replay gap. Serve the durable index immediately and repair it off the
    // request path; Changes must never wait for a 10-30 MB rollout replay.
    this.#scheduleResourceRefresh(threadId);
    return entry;
  }

  #appendResourceTurn(threadId: string, turn: CachedTurn): void {
    const entry = this.#resourceEntries.get(threadId);
    if (entry === undefined || !entry.index.appendCompletedTurn(turn)) return;
    entry.dirtyFromEvents = true;
    entry.touchedAt = Date.now();
    this.#scheduleResourcePersist(threadId, entry);
  }

  #upsertLiveResourceTurn(threadId: string, turn: CachedTurn): void {
    const live = this.#liveResourceTurns.get(threadId) ?? new Map<string, CachedTurn>();
    live.set(turn.id, turn);
    this.#liveResourceTurns.set(threadId, live);
    const entry = this.#resourceEntries.get(threadId);
    if (entry !== undefined) entry.index.upsertTurn(turn);
  }

  #observeResourceItemEvent(threadId: string, method: string, params: RpcObject): void {
    if (method !== "item/started" && method !== "item/completed" && method !== "item/fileChange/patchUpdated") return;
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    if (turnId === null) return;
    const live = this.#liveResourceTurns.get(threadId) ?? new Map<string, CachedTurn>();
    const previous = live.get(turnId);
    const items = previous?.items.slice() ?? [];
    if (method === "item/fileChange/patchUpdated") {
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      if (itemId === null || !Array.isArray(params.changes)) return;
      const index = items.findIndex((item) => item.id === itemId);
      const item = index === -1
        ? { id: itemId, type: "fileChange", changes: params.changes }
        : { ...items[index]!, type: "fileChange", changes: params.changes };
      if (index === -1) items.push(item);
      else items[index] = item;
    } else {
      const item = asObject(params.item);
      if (item === null || typeof item.id !== "string") return;
      const index = items.findIndex((candidate) => candidate.id === item.id);
      if (index === -1) items.push(item);
      else items[index] = item;
    }
    const turn: CachedTurn = { ...(previous ?? {}), id: turnId, items, status: "inProgress" };
    live.set(turnId, turn);
    this.#liveResourceTurns.set(threadId, live);
    const entry = this.#resourceEntries.get(threadId);
    if (entry !== undefined) entry.index.upsertTurn(turn);
  }

  #scheduleResourceRefresh(threadId: string): void {
    if (this.#resourceRefreshing.has(threadId) || this.#closed) return;
    const generation = this.#resourceGeneration(threadId);
    const startedAt = performance.now();
    const refresh = requestFullThread(this.#connectUpstream, threadId, this.#requestTimeoutMs)
      .then((response) => {
        if (this.#closed || this.#resourceGeneration(threadId) !== generation) return;
        const thread = asObject(response.thread);
        if (thread === null || !Array.isArray(thread.turns)) throw new Error("thread/read returned no history");
        const turns = thread.turns.map(parseTurn);
        const cwd = typeof thread.cwd === "string" && path.isAbsolute(thread.cwd) ? path.normalize(thread.cwd) : null;
        const next: ResourceCacheEntry = {
          index: AppendOnlyThreadResourceIndex.fromTurns(threadId, turns, cwd),
          touchedAt: Date.now(),
          recencyAt: finiteNumber(thread.recencyAt),
          dirtyFromEvents: false,
        };
        if (mergeObservedResourceTurns(next, this.#observedTurns.get(threadId))) next.dirtyFromEvents = true;
        mergeLiveResourceTurns(next, this.#liveResourceTurns.get(threadId));
        if (this.#resourceGeneration(threadId) !== generation) return;
        this.#resourceEntries.set(threadId, next);
        this.#scheduleResourcePersist(threadId, next);
        console.info(JSON.stringify({
          status: "thread-resource-index-repaired",
          threadId,
          turns: turns.length,
          durationMs: Math.round(performance.now() - startedAt),
        }));
      })
      .catch((cause) => console.warn(JSON.stringify({
        status: "thread-resource-index-repair-failed",
        threadId,
        error: cause instanceof Error ? cause.message : "unknown",
      })))
      .finally(() => {
        if (this.#resourceRefreshing.get(threadId) === refresh) this.#resourceRefreshing.delete(threadId);
      });
    this.#resourceRefreshing.set(threadId, refresh);
  }

  async #loadPersistedResource(threadId: string): Promise<ResourceCacheEntry | null> {
    if (this.#cacheDirectory === undefined) return null;
    try {
      const compressed = await readFile(this.#resourceCachePath(threadId));
      const raw = await gunzipAsync(compressed);
      if (raw.byteLength > this.#maxEntryBytes) throw new Error("persisted resource index is oversized");
      const envelope = asObject(JSON.parse(raw.toString("utf8")));
      if (envelope?.version !== 1 || envelope.threadId !== threadId) throw new Error("persisted resource index is invalid");
      const entry: ResourceCacheEntry = {
        index: AppendOnlyThreadResourceIndex.restore(envelope.index),
        touchedAt: Date.now(),
        recencyAt: finiteNumber(envelope.recencyAt),
        dirtyFromEvents: false,
      };
      console.info(JSON.stringify({ status: "thread-resource-index-restored", threadId }));
      return entry;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(this.#resourceCachePath(threadId), { force: true }).catch(() => undefined);
      }
      return null;
    }
  }

  #scheduleResourcePersist(threadId: string, entry: ResourceCacheEntry): void {
    if (this.#cacheDirectory === undefined || this.#closed) return;
    const generation = this.#resourceGeneration(threadId);
    const envelope = {
      version: 1,
      threadId,
      recencyAt: entry.recencyAt,
      index: entry.index.serialize(),
    };
    const previous = this.#resourcePersistChains.get(threadId) ?? Promise.resolve();
    const persistence = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.#resourceGeneration(threadId) !== generation) return;
        await this.#persistResourceEnvelope(threadId, envelope, generation);
      })
      .catch((cause) => console.warn(JSON.stringify({
        status: "thread-resource-index-persist-failed",
        threadId,
        error: cause instanceof Error ? cause.message : "unknown",
      })))
      .finally(() => {
        this.#persisting.delete(persistence);
        if (this.#resourcePersistChains.get(threadId) === persistence) this.#resourcePersistChains.delete(threadId);
      });
    this.#resourcePersistChains.set(threadId, persistence);
    this.#persisting.add(persistence);
  }

  async #persistResourceEnvelope(threadId: string, envelope: RpcObject, generation: number): Promise<void> {
    if (this.#cacheDirectory === undefined || this.#closed) return;
    await mkdir(this.#cacheDirectory, { recursive: true, mode: 0o700 });
    const target = this.#resourceCachePath(threadId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(envelope)), { level: 6 });
    try {
      if (this.#closed || this.#resourceGeneration(threadId) !== generation) return;
      await writeFile(temporary, compressed, { mode: 0o600, flag: "wx" });
      if (this.#closed || this.#resourceGeneration(threadId) !== generation) return;
      await rename(temporary, target);
      await this.#pruneDisk();
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #load(threadId: string): Promise<CacheEntry> {
    const startedAt = performance.now();
    const response = await requestFullThread(this.#connectUpstream, threadId, this.#requestTimeoutMs);
    const thread = asObject(response.thread);
    if (thread === null || !Array.isArray(thread.turns)) throw new Error("thread/read returned no history");
    const turns = thread.turns.map(parseTurn);
    const cwd = typeof thread.cwd === "string" && path.isAbsolute(thread.cwd) ? path.normalize(thread.cwd) : null;
    const bytes = Buffer.byteLength(JSON.stringify(turns));
    if (bytes > this.#maxEntryBytes) throw new Error("Thread history exceeds the host cache entry limit");
    const recencyAt = finiteNumber(thread.recencyAt);
    const entry = { turns, cwd, bytes, touchedAt: Date.now(), recencyAt, dirtyFromEvents: false };
    mergeObservedTurns(entry, this.#observedTurns.get(threadId));
    this.#entries.set(threadId, entry);
    this.#totalBytes += bytes;
    this.#evict(threadId);
    this.#schedulePersist(threadId, entry);
    console.info(JSON.stringify({
      status: "legacy-history-indexed",
      threadId,
      turns: turns.length,
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
    }));
    return entry;
  }

  #schedulePersist(threadId: string, entry: CacheEntry): void {
    const persistence = this.#persist(threadId, entry).catch((cause) => console.warn(JSON.stringify({
      status: "legacy-history-persist-failed",
      threadId,
      error: cause instanceof Error ? cause.message : "unknown",
    }))).finally(() => this.#persisting.delete(persistence));
    this.#persisting.add(persistence);
  }

  async #loadPersisted(threadId: string): Promise<CacheEntry | null> {
    if (this.#cacheDirectory === undefined) return null;
    try {
      const compressed = await readFile(this.#cachePath(threadId));
      const raw = await gunzipAsync(compressed);
      if (raw.byteLength > this.#maxEntryBytes) throw new Error("persisted history cache entry is oversized");
      const envelope = asObject(JSON.parse(raw.toString("utf8")));
      if (envelope?.version !== 2 || envelope.threadId !== threadId || !Array.isArray(envelope.turns)) {
        throw new Error("persisted history cache entry is invalid");
      }
      const turns = envelope.turns.map(parseTurn);
      const cwd = typeof envelope.cwd === "string" && path.isAbsolute(envelope.cwd) ? path.normalize(envelope.cwd) : null;
      const bytes = Buffer.byteLength(JSON.stringify(turns));
      const recencyAt = finiteNumber(envelope.recencyAt);
      const entry = { turns, cwd, bytes, touchedAt: Date.now(), recencyAt, dirtyFromEvents: false };
      mergeObservedTurns(entry, this.#observedTurns.get(threadId));
      this.#entries.set(threadId, entry);
      this.#totalBytes += bytes;
      this.#evict(threadId);
      // mtime is the disk LRU clock; touching via rewrite would waste I/O, so
      // the bounded prune order is creation/refresh order rather than access.
      console.info(JSON.stringify({ status: "legacy-history-restored", threadId, turns: turns.length, bytes }));
      return entry;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(this.#cachePath(threadId), { force: true }).catch(() => undefined);
      }
      return null;
    }
  }

  async #persist(threadId: string, entry: CacheEntry): Promise<void> {
    if (this.#cacheDirectory === undefined || this.#closed) return;
    await mkdir(this.#cacheDirectory, { recursive: true, mode: 0o700 });
    const target = this.#cachePath(threadId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const compressed = await gzipAsync(Buffer.from(JSON.stringify({
      version: 2,
      threadId,
      cwd: entry.cwd,
      recencyAt: entry.recencyAt,
      turns: entry.turns,
    })), { level: 6 });
    try {
      await writeFile(temporary, compressed, { mode: 0o600, flag: "wx" });
      await rename(temporary, target);
      await this.#pruneDisk();
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #pruneDisk(): Promise<void> {
    if (this.#cacheDirectory === undefined) return;
    const files = (await readdir(this.#cacheDirectory)).filter((name) => name.endsWith(".json.gz"));
    const entries = await Promise.all(files.map(async (name) => {
      const filePath = path.join(this.#cacheDirectory!, name);
      const info = await stat(filePath);
      return { filePath, bytes: info.size, modifiedAt: info.mtimeMs };
    }));
    let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
    for (const entry of entries.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (bytes <= this.#maxDiskBytes) break;
      await rm(entry.filePath, { force: true });
      bytes -= entry.bytes;
    }
  }

  #cachePath(threadId: string): string {
    if (this.#cacheDirectory === undefined) throw new Error("History cache directory is disabled");
    const name = createHash("sha256").update(threadId).digest("hex");
    return path.join(this.#cacheDirectory, `${name}.json.gz`);
  }

  #resourceCachePath(threadId: string): string {
    if (this.#cacheDirectory === undefined) throw new Error("History cache directory is disabled");
    const name = createHash("sha256").update(threadId).digest("hex");
    return path.join(this.#cacheDirectory, `${name}.resources.json.gz`);
  }

  #resourceGeneration(threadId: string): number {
    return this.#resourceGenerations.get(threadId) ?? 0;
  }

  #evict(protectedThreadId: string): void {
    while (this.#totalBytes > this.#maxTotalBytes) {
      const oldest = [...this.#entries.entries()]
        .filter(([threadId]) => threadId !== protectedThreadId)
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
      if (oldest === undefined) break;
      this.#entries.delete(oldest[0]);
      this.#totalBytes = Math.max(0, this.#totalBytes - oldest[1].bytes);
    }
  }
}

type CurrentChangeAvailability = "available" | "deleted" | "unavailable";

async function withCurrentChangeAvailability(snapshot: ThreadResourcesSnapshot): Promise<ThreadResourcesSnapshot & {
  changes: Array<ThreadResourcesSnapshot["changes"][number] & { availability: CurrentChangeAvailability }>;
}> {
  const changes: Array<ThreadResourcesSnapshot["changes"][number] & { availability: CurrentChangeAvailability }> = [];
  // A thread can contain thousands of edits. Bound concurrent stat calls so
  // opening the session sheet does not create an IO burst on large histories.
  for (let offset = 0; offset < snapshot.changes.length; offset += 32) {
    const batch = snapshot.changes.slice(offset, offset + 32);
    changes.push(...await Promise.all(batch.map(async (change) => ({
      ...change,
      availability: await currentChangeAvailability(change.path),
    }))));
  }
  const availabilityRevision = createHash("sha256")
    .update(changes.map((change) => `${change.path}\0${change.availability}`).join("\0"))
    .digest("hex")
    .slice(0, 12);
  return {
    ...structuredClone(snapshot),
    revision: `${snapshot.revision}.${availabilityRevision}`,
    changes,
  };
}

async function currentChangeAvailability(filePath: string): Promise<CurrentChangeAvailability> {
  try {
    return (await stat(filePath)).isFile() ? "available" : "unavailable";
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "deleted" : "unavailable";
  }
}

export class CompositeLocalRpcHandler implements LocalRpcHandler {
  readonly #handlers: LocalRpcHandler[];

  constructor(...handlers: LocalRpcHandler[]) {
    this.#handlers = handlers;
  }

  handles(method: string): boolean {
    return this.#handlers.some((handler) => handler.handles(method));
  }

  async handle(clientId: string, method: string, params: RpcObject): Promise<unknown> {
    const handler = this.#handlers.find((candidate) => candidate.handles(method));
    if (handler === undefined) throw new Error(`No local RPC handler for ${method}`);
    return await handler.handle(clientId, method, params);
  }

  releaseClient(clientId: string): void {
    for (const handler of this.#handlers) handler.releaseClient(clientId);
  }

  close(): void {
    for (const handler of this.#handlers) handler.close();
  }
}

async function requestFullThread(connectUpstream: () => WebSocket, threadId: string, timeoutMs: number): Promise<RpcObject> {
  const socket = connectUpstream();
  return await new Promise<RpcObject>((resolve, reject) => {
    const initializeId = `legacy-cache:init:${threadId}`;
    const readId = `legacy-cache:read:${threadId}`;
    let settled = false;
    const finish = (result: { value: RpcObject } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close(1000, "history_index_ready");
      if ("error" in result) reject(result.error);
      else resolve(result.value);
    };
    const timeout = setTimeout(() => finish({ error: new Error("History indexing timed out") }), timeoutMs);
    timeout.unref();
    socket.once("open", () => socket.send(JSON.stringify({
      id: initializeId,
      method: "initialize",
      params: {
        clientInfo: { name: "codewide_history_cache", title: "CodeWide history cache", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    })));
    socket.on("message", (data, isBinary) => {
      if (isBinary || settled) return;
      const message = safeJsonObject(data.toString("utf8"));
      if (message === null) return;
      if (message.id === initializeId) {
        if ("error" in message) {
          finish({ error: new Error(rpcErrorMessage(message.error)) });
          return;
        }
        socket.send(JSON.stringify({ method: "initialized" }));
        socket.send(JSON.stringify({ id: readId, method: "thread/read", params: { threadId, includeTurns: true } }));
        return;
      }
      if (message.id !== readId) return;
      if ("error" in message) finish({ error: new Error(rpcErrorMessage(message.error)) });
      else {
        const result = asObject(message.result);
        finish(result === null ? { error: new Error("thread/read returned an invalid response") } : { value: result });
      }
    });
    socket.once("error", () => finish({ error: new Error("History indexing transport failed") }));
    socket.once("close", (code, reason) => {
      if (!settled) finish({ error: new Error(`History indexing connection closed (${code}: ${reason.toString("utf8")})`) });
    });
  });
}

function turnsPage(threadId: string, turns: CachedTurn[], params: RpcObject, projector?: ContentProjector): RpcObject {
  const direction = params.sortDirection === "asc" ? "asc" : "desc";
  const limit = pageLimit(params.limit);
  const offset = decodeCursor(params.cursor, "turns", threadId, direction);
  const ordered = direction === "asc" ? turns : [...turns].reverse();
  const page = takeProjectedPage(ordered, offset, limit, (turn) => projectTurn(turn, params.itemsView, projector));
  const data = page.data;
  return {
    data,
    nextCursor: offset + data.length < ordered.length ? encodeCursor("turns", threadId, direction, offset + data.length) : null,
    backwardsCursor: data.length === 0 ? null : encodeCursor("turns", threadId, direction === "asc" ? "desc" : "asc", Math.max(0, ordered.length - offset - data.length)),
  };
}

function itemsPage(threadId: string, turns: CachedTurn[], params: RpcObject, projector?: ContentProjector): RpcObject {
  const direction = params.sortDirection === "desc" ? "desc" : "asc";
  const limit = pageLimit(params.limit);
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const entries = turns.flatMap((turn) => turnId !== null && turn.id !== turnId
    ? []
    : turn.items.map((item) => ({ turnId: turn.id, item })));
  const ordered = direction === "asc" ? entries : [...entries].reverse();
  const offset = decodeCursor(params.cursor, "items", threadId, direction);
  const page = takeProjectedPage(ordered, offset, limit, (entry) => ({
    turnId: entry.turnId,
    item: projector?.projectItem(entry.item) ?? compactInlineImagesInItem(entry.item),
  }));
  const data = page.data;
  return {
    data,
    nextCursor: offset + data.length < ordered.length ? encodeCursor("items", threadId, direction, offset + data.length) : null,
    backwardsCursor: data.length === 0 ? null : encodeCursor("items", threadId, direction === "asc" ? "desc" : "asc", Math.max(0, ordered.length - offset - data.length)),
  };
}

function projectTurn(turn: CachedTurn, rawView: unknown, projector?: ContentProjector): RpcObject {
  const view = rawView === "full" || rawView === "notLoaded" ? rawView : "summary";
  if (view === "full") return structuredClone({ ...turn, items: turn.items.map((item) => projector?.projectItem(item) ?? compactInlineImagesInItem(item)), itemsView: "full" });
  if (view === "notLoaded") return structuredClone({ ...turn, items: [], itemsView: "notLoaded" });
  const rawFirstUser = turn.items.find((item) => item.type === "userMessage");
  const firstUser = rawFirstUser === undefined ? undefined : projector?.projectItem(rawFirstUser) ?? compactInlineImagesInItem(rawFirstUser);
  const rawFinalAgent = [...turn.items].reverse().find((item) => item.type === "agentMessage");
  const finalAgent = rawFinalAgent === undefined ? undefined : projector?.projectItem(rawFinalAgent) ?? rawFinalAgent;
  const items = firstUser === undefined ? (finalAgent === undefined ? [] : [finalAgent])
    : finalAgent === undefined || firstUser.id === finalAgent.id ? [firstUser] : [firstUser, finalAgent];
  const finalAgentIndex = rawFinalAgent === undefined ? -1 : turn.items.lastIndexOf(rawFinalAgent);
  const kinds = turn.items.flatMap((item, index) => item.type === "userMessage" || index === finalAgentIndex || typeof item.type !== "string" ? [] : [item.type]);
  const codewide = asObject(turn.codewide) ?? {};
  return structuredClone({
    ...turn,
    items,
    itemsView: "summary",
    ...(kinds.length === 0 ? {} : { codewide: { ...codewide, activity: { count: kinds.length, kinds } } }),
  });
}

function mergeObservedTurns(entry: CacheEntry, observed: ReadonlyMap<string, CachedTurn> | undefined): boolean {
  if (observed === undefined || observed.size === 0) return false;
  const indexes = new Map(entry.turns.map((turn, index) => [turn.id, index] as const));
  let changed = false;
  for (const candidate of observed.values()) {
    const index = indexes.get(candidate.id);
    if (index === undefined) {
      entry.turns.push(candidate);
      indexes.set(candidate.id, entry.turns.length - 1);
      entry.bytes += turnBytes(candidate);
      changed = true;
      continue;
    }
    const previous = entry.turns[index]!;
    const next = preferRicherTurn(previous, candidate);
    if (next === previous) continue;
    entry.turns[index] = next;
    entry.bytes += turnBytes(next) - turnBytes(previous);
    changed = true;
  }
  if (changed) {
    entry.dirtyFromEvents = true;
  }
  return changed;
}

function mergeObservedResourceTurns(entry: ResourceCacheEntry, observed: ReadonlyMap<string, CachedTurn> | undefined): boolean {
  if (observed === undefined || observed.size === 0) return false;
  let changed = false;
  for (const turn of observed.values()) changed = entry.index.appendCompletedTurn(turn) || changed;
  return changed;
}

function mergeLiveResourceTurns(entry: ResourceCacheEntry, live: ReadonlyMap<string, CachedTurn> | undefined): void {
  if (live === undefined) return;
  for (const turn of live.values()) entry.index.upsertTurn(turn);
}

function preferRicherTurn(previous: CachedTurn | undefined, candidate: CachedTurn): CachedTurn {
  if (previous === undefined) return candidate;
  const previousTerminal = previous.status !== "inProgress";
  const candidateTerminal = candidate.status !== "inProgress";
  if (candidateTerminal !== previousTerminal) return candidateTerminal ? candidate : previous;
  if (candidate.items.length !== previous.items.length) return candidate.items.length > previous.items.length ? candidate : previous;
  return turnBytes(candidate) > turnBytes(previous) ? candidate : previous;
}

function turnBytes(turn: CachedTurn): number {
  return Buffer.byteLength(JSON.stringify(turn));
}

function parseTurn(value: unknown): CachedTurn {
  const turn = asObject(value);
  if (turn === null || typeof turn.id !== "string" || !Array.isArray(turn.items)) throw new Error("thread/read returned an invalid turn");
  return { ...turn, id: turn.id, items: turn.items.map((item) => {
    const parsed = asObject(item);
    if (parsed === null) throw new Error("thread/read returned an invalid item");
    return parsed;
  }) };
}

function encodeCursor(kind: "turns" | "items", threadId: string, direction: string, offset: number): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify({ kind, threadId, direction, offset })).toString("base64url");
}

function decodeCursor(value: unknown, kind: "turns" | "items", threadId: string, direction: string): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value !== "string" || !value.startsWith(CURSOR_PREFIX)) throw new Error("History cursor is invalid or expired");
  const parsed = safeJsonObject(Buffer.from(value.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  if (parsed?.kind !== kind || parsed.threadId !== threadId || parsed.direction !== direction || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) {
    throw new Error("History cursor is invalid or expired");
  }
  return Number(parsed.offset);
}

function pageLimit(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, value))
    : DEFAULT_PAGE_SIZE;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}

function safeJsonObject(raw: string): RpcObject | null {
  try { return asObject(JSON.parse(raw)); } catch { return null; }
}

function rpcErrorMessage(value: unknown): string {
  const error = asObject(value);
  return typeof error?.message === "string" ? error.message : "App Server request failed";
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
