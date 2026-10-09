/**
 * The sidecar's own journal: the only persistent state it writes.
 *
 * Layout under `--journal-directory` (directory mode 0700, files 0600):
 *
 *   threads/<appThreadId>/thread.json        ThreadRecord (metadata, settings, tombstone)
 *   threads/<appThreadId>/turns/<seq>.json   TurnRecord (one per turn, seq zero-padded)
 *
 * Every write is atomic (temporary file in the same directory, fsync, then
 * rename), so a crash leaves either the old or the new record. A turn is
 * written when it starts and rewritten when it ends, before its
 * `turn.completed` event is emitted. The journal never touches state.redb,
 * CODEX_HOME or any Claude configuration directory.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTurn, ThreadSettings, TokenUsage } from "../protocol.js";

export const JOURNAL_VERSION = 1;

export interface ThreadRecord {
  readonly version: typeof JOURNAL_VERSION;
  readonly appThreadId: string;
  /** Claude session id; equals `appThreadId` until a lost session is replaced. */
  readonly claudeSessionId: string;
  /** Whether the session was opened once, so the next open must `resume`. */
  readonly sessionStarted: boolean;
  readonly cwd: string;
  readonly name: string | null;
  readonly preview: string;
  /** Text of the first user message; `null` while the thread is a shell. */
  readonly firstUserMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt: number | null;
  readonly archived: boolean;
  /** Tombstone: deletion time, or `null`. */
  readonly deletedAt: number | null;
  readonly settings: ThreadSettings;
  /** Settings accepted but not yet applied (applied at the next turn boundary). */
  readonly pendingSettings: ThreadSettings | null;
  readonly totalUsage: TokenUsage;
  readonly turnCount: number;
}

export interface PromptRecord {
  readonly uuid: string | null;
  readonly clientMessageId: string | null;
}

export interface TurnRecord {
  readonly version: typeof JOURNAL_VERSION;
  readonly seq: number;
  readonly turn: AgentTurn;
  readonly prompts: readonly PromptRecord[];
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

const seqName = (seq: number): string => `${String(seq).padStart(8, "0")}.json`;

const isSafeId = (id: string): boolean => /^[A-Za-z0-9-]{1,128}$/.test(id);

export class Journal {
  private readonly threadsDirectory: string;

  constructor(private readonly root: string) {
    this.threadsDirectory = join(root, "threads");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    mkdirSync(this.threadsDirectory, { recursive: true, mode: 0o700 });
  }

  private threadDirectory(appThreadId: string): string {
    if (!isSafeId(appThreadId)) throw new Error("journal thread id is not a safe path segment");
    return join(this.threadsDirectory, appThreadId);
  }

  /** Atomically replaces `path` with `value` as JSON. */
  private writeAtomic(directory: string, name: string, value: unknown): void {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeSync(descriptor, JSON.stringify(value));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, join(directory, name));
  }

  writeThread(record: ThreadRecord): void {
    this.writeAtomic(this.threadDirectory(record.appThreadId), "thread.json", record);
  }

  writeTurn(appThreadId: string, record: TurnRecord): void {
    this.writeAtomic(join(this.threadDirectory(appThreadId), "turns"), seqName(record.seq), record);
  }

  /** Every thread record, including tombstones. Unreadable records are skipped and reported. */
  loadThreads(onError: (appThreadId: string, error: Error) => void): readonly ThreadRecord[] {
    const records: ThreadRecord[] = [];
    for (const entry of readdirSync(this.threadsDirectory)) {
      if (!isSafeId(entry)) continue;
      const path = join(this.threadsDirectory, entry, "thread.json");
      if (!existsSync(path)) continue;
      try {
        // WHY: records are written only by `writeThread` with this schema
        // version; the version check below rejects foreign data.
        const record = JSON.parse(readFileSync(path, "utf8")) as ThreadRecord;
        if (record.version !== JOURNAL_VERSION || record.appThreadId !== entry) {
          throw new Error("journal thread record has an unexpected version or id");
        }
        records.push(record);
      } catch (error) {
        onError(entry, error instanceof Error ? error : new Error(String(error)));
      }
    }
    return records;
  }

  /** Turn records of one thread in sequence order. */
  loadTurns(appThreadId: string): readonly TurnRecord[] {
    const directory = join(this.threadDirectory(appThreadId), "turns");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => /^\d{8}\.json$/.test(name))
      .sort()
      .map((name) => {
        // WHY: written only by `writeTurn` with this schema.
        const record = JSON.parse(readFileSync(join(directory, name), "utf8")) as TurnRecord;
        if (record.version !== JOURNAL_VERSION) throw new Error("journal turn record has an unexpected version");
        return record;
      });
  }
}
