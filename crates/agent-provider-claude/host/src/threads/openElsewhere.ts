/**
 * Which sessions another Claude process holds right now: a `claude --bg`
 * background agent or a terminal. Claude refuses to resume a session a
 * background agent runs, and two processes writing one session would fork
 * its history, so the host runs no turn in a held session and reports its
 * thread `openElsewhere`.
 *
 * The running set comes from `RunningSessions`; a session this host's own
 * live query runs is not held elsewhere. A read younger than `MAX_AGE_MS` is
 * reused (a monotonic age, not thread time). While any session is held the set is re-read every `pollMs`, so a
 * release reaches clients without a new read. A failed read keeps the last
 * known set.
 */

import { performance } from "node:perf_hooks";
import type { RunningSessions } from "../claude/port.js";
import type { Logger } from "../log.js";

const MAX_AGE_MS = 2000;

export interface OpenElsewhereDeps {
  /** Receives the sessions whose held state changed with a read. */
  readonly changed: (sessionIds: ReadonlySet<string>) => void;
  readonly logger: Logger;
  /** Whether a live query of this host runs the session. */
  readonly ownsLive: (sessionId: string) => boolean;
  readonly pollMs: number;
  readonly running: RunningSessions;
}

export class OpenElsewhere {
  private readonly deps: OpenElsewhereDeps;
  private running: ReadonlySet<string> = new Set();
  private readAtMs: number | null = null;
  private inFlight: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  public constructor(deps: OpenElsewhereDeps) {
    this.deps = deps;
  }

  /** From the last read; `refresh` or `check` brings it up to date. */
  public isHeld(sessionId: string): boolean {
    return this.running.has(sessionId) && !this.deps.ownsLive(sessionId);
  }

  /** Re-reads the running set unless the last read is fresh. */
  public async refresh(): Promise<void> {
    const readAtMs = this.readAtMs;
    if (readAtMs !== null && performance.now() - readAtMs < MAX_AGE_MS) {
      return;
    }
    await this.read();
  }

  /** Starts a `refresh` without waiting; a change reaches `changed`. */
  public refreshInBackground(): void {
    this.inBackground(this.refresh());
  }

  /** Whether the session is held elsewhere, from a fresh read. */
  public async check(sessionId: string): Promise<boolean> {
    await this.refresh();
    return this.isHeld(sessionId);
  }

  public shutdown(): void {
    this.stopped = true;
    this.clearPoll();
  }

  private async read(): Promise<void> {
    this.inFlight ??= this.readOnce().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async readOnce(): Promise<void> {
    const before = this.heldSessions();
    try {
      this.running = await this.deps.running.list();
    } catch (error) {
      this.deps.logger.log("warn", "claude running sessions read failed", {
        err: error instanceof Error ? error : new Error(String(error)),
      });
    }
    this.readAtMs = performance.now();
    const after = this.heldSessions();
    const changed = new Set<string>();
    for (const sessionId of before) {
      if (!after.has(sessionId)) {
        changed.add(sessionId);
      }
    }
    for (const sessionId of after) {
      if (!before.has(sessionId)) {
        changed.add(sessionId);
      }
    }
    this.schedulePoll(after.size > 0);
    if (changed.size > 0) {
      this.deps.changed(changed);
    }
  }

  private heldSessions(): ReadonlySet<string> {
    const held = new Set<string>();
    for (const sessionId of this.running) {
      if (!this.deps.ownsLive(sessionId)) {
        held.add(sessionId);
      }
    }
    return held;
  }

  private schedulePoll(anyHeld: boolean): void {
    this.clearPoll();
    if (!anyHeld || this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.inBackground(this.read());
    }, this.deps.pollMs);
    this.pollTimer.unref();
  }

  private inBackground(work: Promise<void>): void {
    work.catch((error: unknown) => {
      this.deps.logger.log("warn", "claude running sessions refresh failed", {
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
