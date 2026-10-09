/**
 * JSON-RPC framing of `codewide-agent` v1 over JSONL stdio.
 *
 * One JSON object per line. The companion sends operation requests and the
 * `initialized` notification; the provider sends responses and `event`
 * notifications. Runtime questions for the user travel as `request.opened`
 * events and are answered with `request.respond`. The only requests a
 * provider sends are the provider requests of `ProviderRequestMap`
 * (`tool.call`), which the companion answers on the same channel; their ids
 * are minted by the provider and are independent of the companion's ids.
 */

import type { AgentEvent } from "./events";
import type {
  OperationName,
  OperationParams,
  OperationResult,
  ProviderRequestName,
  ProviderRequestParams,
  ProviderRequestResult,
} from "./operations";
import type { AccountUpdatedNotification } from "./providers";

export type RpcId = string | number;

export type ProtocolRequest = {
  readonly [Name in OperationName]: {
    readonly id: RpcId;
    readonly method: Name;
    readonly params: OperationParams<Name>;
  };
}[OperationName];

/** A request the provider sends to the companion. */
export type ProviderRequest = {
  readonly [Name in ProviderRequestName]: {
    readonly id: RpcId;
    readonly method: Name;
    readonly params: ProviderRequestParams<Name>;
  };
}[ProviderRequestName];

/** The companion's answer to a provider request. */
export type ProviderRequestResponse<Name extends ProviderRequestName = ProviderRequestName> =
  | { readonly id: RpcId; readonly result: ProviderRequestResult<Name> }
  | { readonly error: RpcError; readonly id: RpcId };

export interface RpcError {
  readonly code: number;
  readonly data: RpcErrorData | null;
  readonly message: string;
}

/** Structured error data. `capability` is set for `CAPABILITY_UNSUPPORTED`. */
export interface RpcErrorData {
  readonly capability: string | null;
  readonly provider: string | null;
}

export type ProtocolResponse<Name extends OperationName = OperationName> =
  | { readonly id: RpcId; readonly result: OperationResult<Name> }
  | { readonly error: RpcError; readonly id: RpcId };

export interface EventNotification {
  readonly method: "event";
  readonly params: AgentEvent;
}

export interface InitializedNotification {
  readonly method: "initialized";
}

export type ProtocolMessage =
  | ProtocolRequest
  | ProtocolResponse
  | ProviderRequest
  | ProviderRequestResponse
  | EventNotification
  | InitializedNotification
  | AccountUpdatedNotification;

const INVALID_REQUEST = -32_600;
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;
const INTERNAL_ERROR = -32_603;
const PROVIDER_DISABLED = -32_070;
const CAPABILITY_UNSUPPORTED = -32_072;

/** JSON-RPC error codes shared by the companion and providers. */
export interface ErrorCodes {
  /** The thread's provider does not declare the capability the call needs. */
  readonly capabilityUnsupported: number;
  readonly internal: number;
  readonly invalidParams: number;
  /** Invalid request or unknown thread: `"thread not found: <id>"`, `"expected turn is not active"`. */
  readonly invalidRequest: number;
  readonly methodNotFound: number;
  /** Companion: the thread's provider is disabled on this host. Terminal for queued commands. */
  readonly providerDisabled: number;
}

/** Error codes shared by the companion and providers. */
export const ERROR_CODES: ErrorCodes = {
  capabilityUnsupported: CAPABILITY_UNSUPPORTED,
  internal: INTERNAL_ERROR,
  invalidParams: INVALID_PARAMS,
  invalidRequest: INVALID_REQUEST,
  methodNotFound: METHOD_NOT_FOUND,
  providerDisabled: PROVIDER_DISABLED,
};

export function threadNotFoundMessage(appThreadId: string): string {
  return `thread not found: ${appThreadId}`;
}

export function nativeSessionNotFoundMessage(sessionId: string): string {
  return `native session not found: ${sessionId}`;
}

export const EXPECTED_TURN_NOT_ACTIVE = "expected turn is not active" as const;

export function capabilityUnsupportedMessage(capability: string): string {
  return `${capability} is not supported by this thread's agent`;
}
