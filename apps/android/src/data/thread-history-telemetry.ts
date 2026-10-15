import { appLogger } from "../observability/logger";
import type { ThreadHistoryLoadDirection } from "./thread-history-load-coordinator";
import {
  recordOperationalTelemetryEvent,
  recordTelemetryEvent,
  type TelemetryEventInput,
} from "./telemetry";

type ThreadHistoryTelemetryInput = Omit<TelemetryEventInput, "name" | "connectionId" | "threadId">;

/** Low-volume opening diagnostics stay available without enabling render profiling. */
export function recordThreadOpeningMeasure(
  connectionId: string,
  threadId: string,
  stage: "queue_wait" | "sqlite_read" | "cache_read" | "hydrate" | "open",
  durationMs: number,
): void {
  if (connectionId === "" || threadId === "") {
    return;
  }
  recordOperationalTelemetryEvent(connectionId, {
    connectionId,
    name: "chat.window.open_stage",
    tags: { stage },
    threadId,
    values: { durationMs },
  });
}

/** Records content-free diagnostics for the chat viewport and its durable history window. */
export function recordThreadHistoryTelemetry(
  connectionId: string,
  threadId: string,
  name: string,
  input: ThreadHistoryTelemetryInput = {},
): void {
  if (connectionId === "" || threadId === "") {
    return;
  }
  recordTelemetryEvent(connectionId, {
    ...input,
    connectionId,
    name,
    threadId,
  });
}

/**
 * A failed history page leaves the conversation on cached rows ("update
 * delayed"), so its cause is reported even when profiling is off: an
 * operational event for counting and a diagnostic log carrying the Error.
 */
export function reportThreadHistoryLoadFailure(failure: {
  readonly connectionId: string;
  readonly direction: ThreadHistoryLoadDirection;
  readonly error: unknown;
  readonly historyEpoch: number;
  readonly threadId: string;
}): void {
  const { connectionId, direction, error, historyEpoch, threadId } = failure;
  if (connectionId === "" || threadId === "") {
    return;
  }
  recordOperationalTelemetryEvent(connectionId, {
    connectionId,
    name: "chat.history.load_failed",
    tags: { direction, errorKind: telemetryErrorKind(error) },
    threadId,
    values: { historyEpoch },
  });
  appLogger.warnCaught({
    error,
    event: "chat.history.load_failed",
    fields: { connectionId, direction, historyEpoch, threadId },
  });
}

export function telemetryErrorKind(cause: unknown): string {
  if (cause instanceof Error && cause.name.length > 0) {
    return cause.name.slice(0, 128);
  }
  return "unknown";
}
