/**
 * Persistence of the host's own thread metadata: the only files the host
 * writes.
 *
 * Layout under the state directory (directory mode 0700, files 0600):
 *
 *   threads/<appThreadId>/state.json        ThreadState (v2)
 *   threads/<appThreadId>/active-turn.json  snapshot of the in-flight turn, removed when it ends
 *
 * Every write is atomic (temporary file in the same directory, fsync, then
 * rename), so a crash leaves either the old or the new record. A directory
 * holding only a v1 journal (`thread.json`) is converted on load; the v1
 * files are left untouched. The store never touches state.redb, CODEX_HOME
 * or Claude's configuration directory.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentTurn } from "../protocol.js";
import { activeTurnFile, threadState } from "./codec.js";
import { convertLegacyThread, LEGACY_THREAD_FILE } from "./legacyJournal.js";
import { THREAD_STATE_VERSION, type ThreadState } from "./threadState.js";

const STATE_FILE = "state.json";
const ACTIVE_TURN_FILE = "active-turn.json";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_ID = /^[A-Za-z0-9-]{1,128}$/u;

/** One thread read at startup. */
export interface StoredThread {
  /** The turn a previous process left in progress, or `null`. */
  readonly activeTurn: AgentTurn | null;
  readonly state: ThreadState;
}

/** Reports a thread directory that could not be read. */
export type LoadErrorSink = (appThreadId: string, error: Error) => void;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export class ThreadStateStore {
  private readonly threadsDirectory: string;

  public constructor(root: string) {
    this.threadsDirectory = join(root, "threads");
    mkdirSync(root, { mode: DIRECTORY_MODE, recursive: true });
    mkdirSync(this.threadsDirectory, { mode: DIRECTORY_MODE, recursive: true });
  }

  private threadDirectory(appThreadId: string): string {
    if (!SAFE_ID.test(appThreadId)) {
      throw new Error("thread id is not a safe path segment");
    }
    return join(this.threadsDirectory, appThreadId);
  }

  /** Atomically replaces `<directory>/<name>` with `value` as JSON. */
  private static writeAtomic(directory: string, name: string, value: unknown): void {
    mkdirSync(directory, { mode: DIRECTORY_MODE, recursive: true });
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", FILE_MODE);
    try {
      writeSync(descriptor, JSON.stringify(value));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, join(directory, name));
  }

  public write(state: ThreadState): void {
    ThreadStateStore.writeAtomic(this.threadDirectory(state.appThreadId), STATE_FILE, state);
  }

  public writeActiveTurn(appThreadId: string, turn: AgentTurn): void {
    ThreadStateStore.writeAtomic(this.threadDirectory(appThreadId), ACTIVE_TURN_FILE, {
      turn,
      version: THREAD_STATE_VERSION,
    });
  }

  public clearActiveTurn(appThreadId: string): void {
    rmSync(join(this.threadDirectory(appThreadId), ACTIVE_TURN_FILE), { force: true });
  }

  private readThread(appThreadId: string): StoredThread | null {
    const directory = this.threadDirectory(appThreadId);
    const statePath = join(directory, STATE_FILE);
    if (existsSync(statePath)) {
      const state = threadState(readJson(statePath), STATE_FILE);
      if (state.appThreadId !== appThreadId) {
        throw new Error("thread state id does not match its directory");
      }
      const activePath = join(directory, ACTIVE_TURN_FILE);
      const activeTurn = existsSync(activePath)
        ? activeTurnFile(readJson(activePath), ACTIVE_TURN_FILE).turn
        : null;
      return { activeTurn, state };
    }
    if (existsSync(join(directory, LEGACY_THREAD_FILE))) {
      const converted = convertLegacyThread(directory, appThreadId);
      this.write(converted.state);
      return converted;
    }
    return null;
  }

  /** Every stored thread, including tombstones. Unreadable threads are skipped and reported. */
  public load(onError: LoadErrorSink): readonly StoredThread[] {
    const threads: StoredThread[] = [];
    for (const appThreadId of readdirSync(this.threadsDirectory)) {
      if (!SAFE_ID.test(appThreadId)) {
        continue;
      }
      try {
        const stored = this.readThread(appThreadId);
        if (stored !== null) {
          threads.push(stored);
        }
      } catch (error) {
        onError(appThreadId, toError(error));
      }
    }
    return threads;
  }
}
