import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

export type ReplayEntry = {
  cursor: number;
  payload: Record<string, unknown>;
};

export type ReplayResult =
  | { snapshotRequired: true; headCursor: number }
  | { snapshotRequired: false; headCursor: number; entries: ReplayEntry[] };

export type ReplayJournalOptions = {
  filePath?: string;
  maxEntries?: number;
  maxBytes?: number;
};

const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

export class ReplayJournal {
  readonly #filePath: string | undefined;
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #entries: ReplayEntry[];
  #totalBytes: number;
  #headCursor: number;
  #writeChain = Promise.resolve();

  private constructor(options: ReplayJournalOptions, entries: ReplayEntry[]) {
    this.#filePath = options.filePath;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1) {
      throw new Error("maxBytes must be a positive safe integer");
    }
    this.#headCursor = entries.at(-1)?.cursor ?? 0;
    this.#entries = entries.slice(-this.#maxEntries);
    this.#totalBytes = this.#entries.reduce((total, entry) => total + serializedBytes(entry), 0);
    while (this.#entries.length > 0 && this.#totalBytes > this.#maxBytes) {
      const removed = this.#entries.shift();
      if (removed !== undefined) this.#totalBytes -= serializedBytes(removed);
    }
  }

  static async open(options: ReplayJournalOptions = {}): Promise<ReplayJournal> {
    if (options.filePath === undefined) return new ReplayJournal(options, []);
    await mkdir(path.dirname(options.filePath), { recursive: true, mode: 0o700 });
    const raw = await readFile(options.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const entries: ReplayEntry[] = [];
    let previous = 0;
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      const parsed = JSON.parse(line) as unknown;
      if (!isReplayEntry(parsed) || parsed.cursor <= previous) {
        throw new Error("Replay journal is corrupt or non-monotonic");
      }
      entries.push(parsed);
      previous = parsed.cursor;
    }
    const journal = new ReplayJournal(options, entries);
    if (raw.length > 0 && entries.length !== journal.#entries.length) await journal.#rewrite(journal.#entries);
    return journal;
  }

  get headCursor(): number {
    return this.#headCursor;
  }

  async append(payload: Record<string, unknown>): Promise<ReplayEntry> {
    const [entry] = await this.appendBatch([payload]);
    if (entry === undefined) throw new Error("Replay batch produced no entry");
    return entry;
  }

  async appendBatch(payloads: readonly Record<string, unknown>[]): Promise<ReplayEntry[]> {
    if (payloads.length === 0) return [];
    const entries = payloads.map((payload, index) => ({ cursor: this.#headCursor + index + 1, payload }));
    const entrySizes = entries.map(serializedBytes);
    if (entrySizes.some((entryBytes) => entryBytes > this.#maxBytes)) throw new Error("Replay entry exceeds maxBytes");
    this.#headCursor = entries.at(-1)?.cursor ?? this.#headCursor;
    this.#entries.push(...entries);
    this.#totalBytes += entrySizes.reduce((total, entryBytes) => total + entryBytes, 0);
    let shouldCompact = false;
    while (this.#entries.length > this.#maxEntries || this.#totalBytes > this.#maxBytes) {
      const removed = this.#entries.shift();
      if (removed !== undefined) this.#totalBytes -= serializedBytes(removed);
      shouldCompact = true;
    }
    // Capture the exact state for this queued write. Reading mutable #entries
    // inside the async task can include a later append and then append it again.
    const compactedSnapshot = shouldCompact ? this.#entries.map((candidate) => structuredClone(candidate)) : null;
    this.#writeChain = this.#writeChain.then(async () => {
      if (this.#filePath === undefined) return;
      if (compactedSnapshot !== null) {
        await this.#rewrite(compactedSnapshot);
        return;
      }
      const handle = await open(this.#filePath, "a", 0o600);
      try {
        await handle.writeFile(`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    await this.#writeChain;
    return entries;
  }

  replay(cursor: number | null): ReplayResult {
    if (cursor === null || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.#headCursor) {
      return { snapshotRequired: true, headCursor: this.#headCursor };
    }
    const floor = this.#entries[0]?.cursor ?? this.#headCursor + 1;
    if (cursor < floor - 1) return { snapshotRequired: true, headCursor: this.#headCursor };
    return {
      snapshotRequired: false,
      headCursor: this.#headCursor,
      entries: this.#entries.filter((entry) => entry.cursor > cursor),
    };
  }

  forEachPayload(visitor: (payload: Readonly<Record<string, unknown>>) => void): void {
    for (const entry of this.#entries) visitor(entry.payload);
  }

  async close(): Promise<void> {
    await this.#writeChain;
  }

  async #rewrite(entries: ReplayEntry[]): Promise<void> {
    if (this.#filePath === undefined) return;
    const temporary = `${this.#filePath}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#filePath);
    const metadata = await stat(this.#filePath);
    if ((metadata.mode & 0o077) !== 0) throw new Error("Replay journal permissions are not private");
  }
}

function serializedBytes(entry: ReplayEntry): number {
  return Buffer.byteLength(JSON.stringify(entry)) + 1;
}

function isReplayEntry(value: unknown): value is ReplayEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ReplayEntry>;
  return (
    Number.isSafeInteger(candidate.cursor) &&
    (candidate.cursor ?? 0) > 0 &&
    candidate.payload !== null &&
    typeof candidate.payload === "object" &&
    !Array.isArray(candidate.payload)
  );
}
