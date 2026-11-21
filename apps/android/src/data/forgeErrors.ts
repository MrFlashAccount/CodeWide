/**
 * Typed classification of Companion forge/review failures.
 *
 * The Companion answers with a code in `-32080..-32089` and JSON-RPC `data`
 * whose `kind` names the failure (`ForgeErrorData`); the native bridge carries
 * that `data`. Classification uses `data.kind` first and the code only when
 * `data` is absent. A result that does not match the wire contract is its own
 * kind, never mistaken for an unreachable companion. Messages are the
 * Companion's short English reason; they never contain forge content or credentials.
 */
import { RpcResponseError } from "@codewide/sync-client";

import { unknownRecord } from "./unknownRecord";

const METHOD_NOT_FOUND = -32_601;
const PROVIDER_UNAVAILABLE = -32_080;
const AUTH_REQUIRED = -32_081;
const STALE_HEAD = -32_082;
const FORGE_REJECTED_OR_UNKNOWN = -32_083;
const CAPABILITY_UNAVAILABLE = -32_084;
/** Companion code of a rejected guide (unknown, duplicate or missing hunks). */
export const INVALID_GUIDE_CODE = -32_085;
/** Companion code of a guide catalog above its hunk or excerpt budget. */
export const GUIDE_TOO_LARGE_CODE = -32_086;
const RATE_LIMITED = -32_087;
const NOT_FOUND_OR_CONFLICT = -32_088;
const CONFIRMATION_REQUIRED = -32_089;

/** Kind of a recognized forge failure. */
type ForgeFailureKind =
  | "authRequired"
  | "capabilityUnavailable"
  | "companionTooOld"
  | "confirmationRequired"
  | "conflict"
  | "contractViolation"
  | "forgeRejected"
  | "guideTooLarge"
  | "invalidGuide"
  | "outcomeUnknown"
  | "providerUnavailable"
  | "rateLimited"
  | "staleHead"
  | "unreachable";

/** A recognized forge failure the UI renders in place. */
export type ForgeFailure = { readonly kind: ForgeFailureKind; readonly message: string };

/** Thrown when a Companion result does not match the wire contract. */
const CONTRACT_VIOLATION = "ForgeContractViolation";

export class ForgeContractViolation extends Error {
  constructor(method: string) {
    super(`The companion sent an invalid ${method} result`);
    this.name = CONTRACT_VIOLATION;
  }
}

const CODE_KINDS = new Map<number, ForgeFailureKind>([
  [PROVIDER_UNAVAILABLE, "providerUnavailable"],
  [AUTH_REQUIRED, "authRequired"],
  [STALE_HEAD, "staleHead"],
  [FORGE_REJECTED_OR_UNKNOWN, "forgeRejected"],
  [CAPABILITY_UNAVAILABLE, "capabilityUnavailable"],
  [INVALID_GUIDE_CODE, "invalidGuide"],
  [GUIDE_TOO_LARGE_CODE, "guideTooLarge"],
  [RATE_LIMITED, "rateLimited"],
  [NOT_FOUND_OR_CONFLICT, "conflict"],
  [CONFIRMATION_REQUIRED, "confirmationRequired"],
  [METHOD_NOT_FOUND, "companionTooOld"],
]);

/** `data.kind` values of `ForgeErrorData` and the failure each names. */
const DATA_KINDS: Readonly<Record<string, ForgeFailureKind>> = {
  authRequired: "authRequired",
  capabilityUnavailable: "capabilityUnavailable",
  confirmationRequired: "confirmationRequired",
  conflict: "conflict",
  forgeRejected: "forgeRejected",
  guideTooLarge: "guideTooLarge",
  invalidGuide: "invalidGuide",
  notFound: "conflict",
  outcomeUnknown: "outcomeUnknown",
  providerUnavailable: "providerUnavailable",
  rateLimited: "rateLimited",
  staleHead: "staleHead",
};

function dataKind(error: RpcResponseError): ForgeFailureKind | undefined {
  const kind = unknownRecord(error.data)?.kind;
  return typeof kind === "string" && Object.hasOwn(DATA_KINDS, kind) ? DATA_KINDS[kind] : undefined;
}

/**
 * Maps a caught failure to a typed forge failure: `data.kind` when the
 * Companion sent it, else the code, else the transport could not reach it.
 */
export function classifyForgeError(error: unknown): ForgeFailure {
  if (error instanceof Error && error.name === CONTRACT_VIOLATION) {
    return { kind: "contractViolation", message: error.message };
  }
  if (!(error instanceof RpcResponseError)) {
    return {
      kind: "unreachable",
      message: error instanceof Error ? error.message : "The companion is unreachable",
    };
  }
  return {
    kind: dataKind(error) ?? CODE_KINDS.get(error.code) ?? "forgeRejected",
    message: error.message,
  };
}
