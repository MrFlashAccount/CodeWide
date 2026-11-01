import { RpcResponseError } from "@codewide/sync-client";

const INVALID_REQUEST = -32_600;
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;
const CAPABILITY_UNSUPPORTED = -32_072;
const REJECTION_CODES: ReadonlySet<number> = new Set([
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  CAPABILITY_UNSUPPORTED,
]);

/** An admitted continuation may have executed despite losing its acknowledgement. */
export class UnconfirmedContinuationError extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : "Continuation failed";
    super(
      `${message}. The start could not be confirmed; wait for thread sync. It will not be sent twice.`,
      { cause },
    );
  }
}

/**
 * Only explicit request validation errors and an unsupported method (a host or
 * provider without `turn/continue`) prove rejection before execution.
 */
export function isRejectedContinuation(error: unknown): boolean {
  return error instanceof RpcResponseError && REJECTION_CODES.has(error.code);
}
