/**
 * Owner of the host's Claude subscription limits: merges every report into
 * one snapshot (`RateLimitBook`) and hands each change to `publish`
 * (`rateLimits.updated`).
 *
 * Reports come from `rate_limit_event` frames of live sessions and from the
 * SDK's experimental usage read, taken by the runtime probe and, at most once
 * per `USAGE_READ_INTERVAL_MS`, through a live query after a turn's result.
 * A usage read is best effort: a failure or an unknown shape changes nothing.
 * Nothing here is a credential, and nothing identifying is logged.
 */

import type { Logger } from "../log.js";
import { RateLimitBook, usageReadWindows } from "../mapping/rateLimits.js";
import type { ProviderRateLimits, ProviderRateLimitWindow } from "../protocol.js";

/** Minimum time between two usage reads through live queries. */
export const USAGE_READ_INTERVAL_MS = 120_000;

const MS_PER_SECOND = 1000;

export interface RateLimitReporterDeps {
  readonly logger: Logger;
  readonly nowMs: () => number;
  /** Called with the full snapshot whenever it changed. */
  readonly publish: (limits: ProviderRateLimits) => void;
}

/** What sessions report to the owner. */
export interface RateLimitSink {
  /** A window a `rate_limit_event` frame reported. */
  readonly reported: (window: ProviderRateLimitWindow) => void;
  /**
   * A query produced a result; `readUsage` performs the SDK usage read
   * through that live query when a read is due.
   */
  readonly resultSeen: (readUsage: () => Promise<unknown>) => void;
}

export class RateLimitReporter implements RateLimitSink {
  private readonly book = new RateLimitBook();
  private readonly deps: RateLimitReporterDeps;
  private lastReadAtMs: number | null = null;
  private reading = false;

  public constructor(deps: RateLimitReporterDeps) {
    this.deps = deps;
  }

  /** The latest snapshot; `null` until the first report. */
  public snapshot(): ProviderRateLimits | null {
    return this.book.snapshot();
  }

  public readonly reported = (window: ProviderRateLimitWindow): void => {
    this.apply([window]);
  };

  public readonly resultSeen = (readUsage: () => Promise<unknown>): void => {
    const now = this.deps.nowMs();
    if (
      this.reading ||
      (this.lastReadAtMs !== null && now - this.lastReadAtMs < USAGE_READ_INTERVAL_MS)
    ) {
      return;
    }
    this.reading = true;
    this.lastReadAtMs = now;
    readUsage()
      .then((response) => {
        this.usageRead(response);
      })
      .catch((error: unknown) => {
        this.deps.logger.log("debug", "claude usage read failed", {
          err: error instanceof Error ? error : new Error(String(error)),
        });
      })
      .finally(() => {
        this.reading = false;
      });
  };

  /** Applies one usage read response (the probe's or a live query's). */
  public usageRead(response: unknown): void {
    this.lastReadAtMs = this.deps.nowMs();
    this.apply(usageReadWindows(response));
  }

  private apply(windows: readonly ProviderRateLimitWindow[]): void {
    if (windows.length === 0) {
      return;
    }
    const next = this.book.apply(windows, Math.floor(this.deps.nowMs() / MS_PER_SECOND));
    if (next !== null) {
      this.deps.publish(next);
    }
  }
}
