import { RpcResponseError } from "@codewide/sync-client";

const INVALID_REQUEST = -32_600;
const INVALID_PARAMS = -32_602;

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

/** Only explicit request validation errors prove rejection before execution. */
export function isRejectedContinuation(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    (error.code === INVALID_REQUEST || error.code === INVALID_PARAMS)
  );
}
