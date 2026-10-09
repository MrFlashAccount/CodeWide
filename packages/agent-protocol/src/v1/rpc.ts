/**
 * JSON-RPC framing of `codewide-agent` v1 over JSONL stdio.
 *
 * One JSON object per line. The companion sends requests and the
 * `initialized` notification; the provider sends responses and `event`
 * notifications. A provider never sends JSON-RPC requests: runtime questions
 * travel as `request.opened` events and are answered with `request.respond`.
 */

import type { AgentEvent } from "./events";
import type { OperationName, OperationParams, OperationResult } from "./operations";

export type RpcId = string | number;

export type ProtocolRequest = {
  readonly [Name in OperationName]: {
    readonly id: RpcId;
    readonly method: Name;
    readonly params: OperationParams<Name>;
  };
}[OperationName];

export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data: RpcErrorData | null;
}

/** Structured error data. `capability` is set for `CAPABILITY_UNSUPPORTED`. */
export interface RpcErrorData {
  readonly capability: string | null;
  readonly provider: string | null;
}

export type ProtocolResponse<Name extends OperationName = OperationName> =
  | { readonly id: RpcId; readonly result: OperationResult<Name> }
  | { readonly id: RpcId; readonly error: RpcError };

export interface EventNotification {
  readonly method: "event";
  readonly params: AgentEvent;
}

export interface InitializedNotification {
  readonly method: "initialized";
}

export type ProtocolMessage = ProtocolRequest | ProtocolResponse | EventNotification | InitializedNotification;

/** Error codes shared by the companion and providers. */
export const ERROR_CODES = {
  /** Invalid request or unknown thread: `"thread not found: <id>"`, `"expected turn is not active"`. */
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Companion: the thread's provider is disabled on this host. Terminal for queued commands. */
  providerDisabled: -32070,
  /** The thread's provider does not declare the capability the call needs. */
  capabilityUnsupported: -32072,
} as const;

export function threadNotFoundMessage(appThreadId: string): string {
  return `thread not found: ${appThreadId}`;
}

export const EXPECTED_TURN_NOT_ACTIVE = "expected turn is not active" as const;

export function capabilityUnsupportedMessage(capability: string): string {
  return `${capability} is not supported by this thread's agent`;
}
