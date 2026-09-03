import type { V2CommandTerminalFrame, V2OpenIntent } from "./frames";
import type { V2Error } from "./model";
import type { V2QueryResult } from "./operations";
import { validateV2ClientFrame } from "./validate-client";

export type Pending<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: Error): void;
  kind: string;
};

export class SyncV2RequestError extends Error {
  readonly detail: V2Error;

  constructor(detail: V2Error) {
    super(detail.message);
    this.detail = detail;
  }
}

const COMMAND_NOT_CREATED_MESSAGE = "Sync V2 command was not durably created";
const COMMAND_DURABLE_UNSETTLED_MESSAGE = "Sync V2 durable command outcome is unsettled";

export class SyncV2CommandNotCreatedError extends Error {
  readonly code = "notCreated" as const;
  readonly retryable = true as const;
  readonly operationId: string;

  constructor(operationId: string) {
    super(COMMAND_NOT_CREATED_MESSAGE);
    this.name = "SyncV2CommandNotCreatedError";
    this.operationId = operationId;
  }
}

export class SyncV2CommandDurableUnsettledError extends Error {
  readonly code = "durableUnsettled" as const;
  readonly retryable = false as const;
  readonly operationId: string;

  constructor(operationId: string) {
    super(COMMAND_DURABLE_UNSETTLED_MESSAGE);
    this.name = "SyncV2CommandDurableUnsettledError";
    this.operationId = operationId;
  }
}

export function isRetryableOperationReceiptFailure(cause: unknown): boolean {
  if (!(cause instanceof SyncV2RequestError)) return true;
  return (
    cause.detail.code === "sourceUnavailable" ||
    cause.detail.code === "rateLimited" ||
    cause.detail.code === "generationChanged"
  );
}

export function validateIntent(intent: V2OpenIntent): V2OpenIntent {
  validateV2ClientFrame({ type: "open", version: 2, intent });
  // WHY: the session retains this public input across reconnects, so it must not retain caller-owned aliases.
  return {
    catalog: {
      activeLimit: intent.catalog.activeLimit,
      archivedLimit: intent.catalog.archivedLimit,
    },
    currentThread:
      intent.currentThread === null
        ? null
        : {
            threadId: intent.currentThread.threadId,
            turnLimit: intent.currentThread.turnLimit,
          },
    pendingRequests: intent.pendingRequests,
  };
}

export function sameIntent(left: V2OpenIntent, right: V2OpenIntent): boolean {
  return (
    left.catalog.activeLimit === right.catalog.activeLimit &&
    left.catalog.archivedLimit === right.catalog.archivedLimit &&
    left.currentThread?.threadId === right.currentThread?.threadId &&
    left.currentThread?.turnLimit === right.currentThread?.turnLimit &&
    left.pendingRequests === right.pendingRequests
  );
}

export function defaultRequestId(): string {
  return crypto.randomUUID();
}

export function compareU64(left: string, right: string): number {
  return left.length === right.length ? left.localeCompare(right) : left.length - right.length;
}

export function validTail(snapshotWatermark: string, tail: string[]): boolean {
  return (
    tail.every((value, index) => index === 0 || compareU64(value, tail[index - 1]!) > 0) &&
    (tail.at(-1) ?? "0") === snapshotWatermark
  );
}

export function commandTerminalState(
  frame: V2CommandTerminalFrame,
): "completed" | "failed" | "indeterminate" | "rejected" | "expired" {
  if (frame.type === "commandCompleted") return "completed";
  if (frame.type === "commandFailed") return "failed";
  if (frame.type === "commandIndeterminate") return "indeterminate";
  return frame.type === "commandRejected" ? "rejected" : "expired";
}

export function pendingPromise<T>(
  map: Map<string, Pending<T>>,
  key: string,
  kind: string,
): Promise<T> {
  if (map.has(key)) throw new Error(`Duplicate Sync V2 request ${key}`);
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  map.set(key, { promise, resolve, reject, kind });
  return promise;
}

export function commandPending(
  map: Map<string, Pending<V2CommandTerminalFrame>>,
  operationId: string,
  kind: string,
): Pending<V2CommandTerminalFrame> {
  const existing = map.get(operationId);
  if (existing !== undefined) return existing;
  pendingPromise(map, operationId, kind);
  return map.get(operationId)!;
}

export function settleRequest<T extends V2QueryResult>(
  map: Map<string, Pending<T>>,
  frame: { requestId: string; result?: T; error?: V2Error },
): void {
  const pending = map.get(frame.requestId);
  if (pending === undefined) return;
  map.delete(frame.requestId);
  if (frame.error !== undefined) pending.reject(new SyncV2RequestError(frame.error));
  else if (frame.result !== undefined && frame.result.kind === pending.kind)
    pending.resolve(frame.result);
  else pending.reject(new Error("Sync V2 result kind does not match its request"));
}
