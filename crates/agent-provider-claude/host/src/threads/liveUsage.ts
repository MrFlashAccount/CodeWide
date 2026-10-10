/**
 * Live usage of the active turn between SDK results.
 *
 * The SDK reports a turn's totals and cost only in its result. Each
 * top-level assistant message carries the usage of the model request that
 * produced it, and one request may arrive as several messages with the same
 * id. A request is reported once, when it is complete: the next request, a
 * user frame (tool results) or a compaction ends it. A result measures every
 * request since the previous one, so it clears the live sum.
 */

import type { TokenUsage } from "../protocol.js";
import type { ClaudeFrame } from "../mapping/frames.js";
import { addUsage, requestUsage, ZERO_USAGE } from "../mapping/usage.js";

/** One complete top-level model request. */
export interface LiveRequest {
  /** Canonical API model id, when the SDK reported it. */
  readonly model: string | null;
  readonly usage: TokenUsage;
}

interface PendingRequest extends LiveRequest {
  readonly messageId: string;
}

export class LiveUsageMeter {
  private pending: PendingRequest | null = null;
  private since: TokenUsage = ZERO_USAGE;

  /** Usage of the requests reported since the last result. */
  get sinceResult(): TokenUsage {
    return this.since;
  }

  /** Observes a top-level content frame; returns the request it completed, if any. */
  observe(frame: ClaudeFrame): LiveRequest | null {
    if (frame.kind === "assistant") {
      if (frame.usage === null) {
        return null;
      }
      const completed =
        this.pending !== null && this.pending.messageId !== frame.messageId
          ? this.complete()
          : null;
      this.pending = {
        messageId: frame.messageId,
        model: frame.model,
        usage: requestUsage(frame.usage),
      };
      return completed;
    }
    if (frame.kind === "user" || frame.kind === "compactBoundary") {
      return this.complete();
    }
    return null;
  }

  /** A result measured every request so far; the pending one is part of it. */
  resultMeasured(): void {
    this.pending = null;
    this.since = ZERO_USAGE;
  }

  private complete(): LiveRequest | null {
    const request = this.pending;
    if (request === null) {
      return null;
    }
    this.pending = null;
    this.since = addUsage(this.since, request.usage);
    return { model: request.model, usage: request.usage };
  }
}
