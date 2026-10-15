import type { Observable } from "@legendapp/state";

import {
  isTerminalHostUpdatePhase,
  type AvailableHostUpdate,
  type HostUpdateOperation,
  type HostUpdateStatus,
} from "./hostUpdateContract";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { HostUpdateHttpError, HostUpdateUnreachableError } from "./hostUpdateTransport";

const PRECONDITION_FAILED_STATUS = 412;
const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;
const LOCKED_STATUS = 423;
const BAD_GATEWAY_STATUS = 502;
const SERVICE_UNAVAILABLE_STATUS = 503;
const GATEWAY_TIMEOUT_STATUS = 504;

export type HostUpdateSnapshot = {
  readonly byConnection: Record<string, HostUpdateView>;
};

export type HostUpdateResource = {
  readonly apply: (connectionId: string, targetFingerprint: string) => Promise<void>;
  readonly check: (connectionId: string) => Promise<void>;
  readonly forget: (connectionId: string) => void;
  readonly observe: (connectionId: string, connected: boolean) => void;
  readonly snapshot$: Observable<HostUpdateSnapshot>;
};

export type UpdateIntent = {
  readonly idempotencyKey: string;
  operationId: string | null;
  readonly targetFingerprint: string;
};

export type HostUpdateResourceRecord = {
  busy: boolean;
  connected: boolean;
  generation: number;
  intent: UpdateIntent | null;
  /** Start of the latest server read; `null` before the first one. */
  lastReadAt: number | null;
  /** A check requested while another read was in flight; it runs right after that read. */
  queuedCheck: PromiseWithResolvers<undefined> | null;
  retryAttempt: number;
  /** When the displayed terminal phase was first published; `null` while none is shown. */
  terminalShownAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** First transient read failure since the latest confirmed status; `null` while reads succeed. */
  transientSince: number | null;
  view: HostUpdateView;
};

export const INITIAL_HOST_UPDATE_VIEW: HostUpdateView = {
  availability: "loading",
  canApply: false,
  canCheck: false,
  canRetry: false,
  currentVersion: null,
  disconnected: false,
  errorCode: null,
  errorMessage: null,
  latestVersion: null,
  operationId: null,
  pending: null,
  phase: null,
  platform: null,
  progress: null,
  targetFingerprint: null,
};

export function hostUpdateStatusView(status: HostUpdateStatus): HostUpdateView {
  const capabilityReady = supportsRemoteApply(status);
  const operation = operationStatusFields(status.activeOperation);
  const target = targetStatusFields(status.availableTarget);
  return {
    availability: hostUpdateAvailability(status, capabilityReady),
    canApply: canApplyStatus(capabilityReady, status),
    canCheck: !operation.pending,
    canRetry: operation.canRetry,
    currentVersion: status.currentVersion,
    disconnected: false,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    latestVersion: target.latestVersion,
    operationId: operation.operationId,
    pending: null,
    phase: operation.phase,
    platform: status.platform,
    progress: status.activeOperation?.progress ?? null,
    targetFingerprint: target.targetFingerprint,
  };
}

export function intentAfterStatus(
  current: UpdateIntent | null,
  status: HostUpdateStatus,
): UpdateIntent | null {
  const operation = status.activeOperation;
  if (operation === null || isTerminalHostUpdatePhase(operation.phase)) {
    // Status may still show the previous outcome. An apply the server has not
    // acknowledged yet stays pending; an acknowledged one has ended.
    return current?.operationId === null ? current : null;
  }
  return {
    idempotencyKey: current?.idempotencyKey ?? "",
    operationId: operation.operationId,
    targetFingerprint: operation.targetFingerprint,
  };
}

export function hostUpdateOperationView(
  previous: HostUpdateView,
  operation: HostUpdateOperation,
): HostUpdateView {
  return {
    ...previous,
    canApply: false,
    canCheck: false,
    canRetry: terminalRetry(operation),
    disconnected: false,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    latestVersion: operation.targetVersion,
    operationId: operation.operationId,
    pending: null,
    phase: operation.phase,
    progress: operation.progress,
    targetFingerprint: operation.targetFingerprint,
  };
}

export function unsupportedHostUpdateView(previous: HostUpdateView): HostUpdateView {
  return {
    ...previous,
    availability: "unsupported",
    canApply: false,
    canCheck: false,
    canRetry: false,
    disconnected: false,
    errorCode: null,
    errorMessage: null,
    pending: null,
  };
}

/**
 * Status confirmed while an apply waits for its acknowledgement: show the
 * fresh versions but keep the request pending, so a concurrent read never
 * offers Update again for the intent that is still being sent.
 */
export function pendingApplyView(status: HostUpdateView): HostUpdateView {
  return {
    ...status,
    canApply: false,
    canCheck: false,
    canRetry: false,
    errorCode: null,
    errorMessage: null,
    operationId: null,
    pending: "apply",
    phase: null,
    progress: null,
  };
}

export function hostUpdateHttpFailureView(
  previous: HostUpdateView,
  error: HostUpdateHttpError,
): HostUpdateView {
  const failure = classifyHttpFailure(error);
  return {
    ...previous,
    availability: failure.availability,
    canApply: false,
    canCheck: failure.canCheck,
    canRetry: false,
    disconnected: false,
    errorCode: failure.errorCode,
    // A manual-update rejection is a known capability state, not a failed update;
    // its message is a machine code that `availability` already classifies.
    errorMessage: failure.availability === "error" ? error.message : null,
    operationId: null,
    pending: null,
    phase: null,
    progress: null,
  };
}

export function hostUpdateTransportFailureView(
  previous: HostUpdateView,
  error: unknown,
  preserveIntent: boolean,
): HostUpdateView {
  return {
    ...previous,
    canApply: false,
    canCheck: !preserveIntent,
    canRetry: false,
    disconnected: preserveIntent,
    errorCode: preserveIntent ? null : "transport_error",
    errorMessage: preserveIntent ? null : errorMessage(error),
    pending: preserveIntent ? previous.pending : null,
  };
}

/**
 * Keeps the last confirmed status while a fresh read could not reach the
 * server, for example while Companion or Relay restarts.
 */
export function hostUpdateWaitingView(previous: HostUpdateView): HostUpdateView {
  return { ...previous, canApply: false, canCheck: true, disconnected: true, pending: null };
}

/** The server did not answer or answered that it is temporarily unavailable. */
export function isTransientHostUpdateFailure(error: unknown): boolean {
  if (error instanceof HostUpdateUnreachableError) {
    return true;
  }
  return (
    error instanceof HostUpdateHttpError &&
    (error.status === BAD_GATEWAY_STATUS ||
      error.status === SERVICE_UNAVAILABLE_STATUS ||
      error.status === GATEWAY_TIMEOUT_STATUS)
  );
}

export function createHostUpdateResourceRecord(connected: boolean): HostUpdateResourceRecord {
  return {
    busy: false,
    connected,
    generation: 0,
    intent: null,
    lastReadAt: null,
    queuedCheck: null,
    retryAttempt: 0,
    terminalShownAt: null,
    timer: null,
    transientSince: null,
    view: INITIAL_HOST_UPDATE_VIEW,
  };
}

export function requireHostUpdateResourceRecord(
  records: ReadonlyMap<string, HostUpdateResourceRecord>,
  connectionId: string,
): HostUpdateResourceRecord {
  const record = records.get(connectionId);
  if (record === undefined) {
    throw new Error("Host update resource has not observed this connection");
  }
  return record;
}

/** Distinguishes definitive apply rejection from a safe idempotent retry. */
export function isRejectedHostUpdateApply(
  record: HostUpdateResourceRecord,
  error: HostUpdateHttpError,
): boolean {
  if (record.intent === null || record.intent.operationId !== null) {
    return false;
  }
  return (
    error.status === BAD_REQUEST_STATUS ||
    error.status === NOT_FOUND_STATUS ||
    error.status === CONFLICT_STATUS ||
    error.status === PRECONDITION_FAILED_STATUS ||
    error.status === LOCKED_STATUS
  );
}

function supportsRemoteApply(status: HostUpdateStatus): boolean {
  const { capability } = status;
  return (
    capability.applySupported &&
    capability.apiVersion === 1 &&
    capability.guardianContractVersion === 1 &&
    capability.journalVersion === 1 &&
    capability.bootstrapVersion === 1
  );
}

function canApplyStatus(capabilityReady: boolean, status: HostUpdateStatus): boolean {
  return (
    capabilityReady && status.availableTarget !== null && !operationPending(status.activeOperation)
  );
}

function operationPending(operation: HostUpdateOperation | null): boolean {
  return operation !== null && !isTerminalHostUpdatePhase(operation.phase);
}

function operationStatusFields(operation: HostUpdateOperation | null): {
  readonly canRetry: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly operationId: string | null;
  readonly pending: boolean;
  readonly phase: HostUpdateOperation["phase"] | null;
} {
  if (operation === null) {
    return {
      canRetry: false,
      errorCode: null,
      errorMessage: null,
      operationId: null,
      pending: false,
      phase: null,
    };
  }
  return {
    canRetry: terminalRetry(operation),
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    operationId: operation.operationId,
    pending: operationPending(operation),
    phase: operation.phase,
  };
}

function targetStatusFields(target: AvailableHostUpdate | null): {
  readonly latestVersion: string | null;
  readonly targetFingerprint: string | null;
} {
  return target === null
    ? { latestVersion: null, targetFingerprint: null }
    : {
        latestVersion: target.target.version,
        targetFingerprint: target.targetFingerprint,
      };
}

function classifyHttpFailure(error: HostUpdateHttpError): {
  readonly availability: HostUpdateView["availability"];
  readonly canCheck: boolean;
  readonly errorCode: string;
} {
  const manual = error.code === "manual_update_required";
  return {
    availability: manual ? manualAvailability(error.message) : "error",
    canCheck: !manual,
    errorCode: failureCode(error, manual),
  };
}

/** Classifies a host's manual-update reason; unknown reasons stay a generic manual update. */
function manualAvailability(reason: string | null): HostUpdateView["availability"] {
  if (reason === "unofficial_build") {
    return "unofficialBuild";
  }
  return reason !== null && /bootstrap/iu.test(reason) ? "manualBootstrap" : "manualUpdate";
}

function failureCode(error: HostUpdateHttpError, manual: boolean): string {
  const staleTarget =
    error.status === PRECONDITION_FAILED_STATUS && !manual && error.code === "precondition_failed";
  return staleTarget ? "stale_target" : error.code;
}

function hostUpdateAvailability(
  status: HostUpdateStatus,
  capabilityReady: boolean,
): HostUpdateView["availability"] {
  return capabilityReady ? "ready" : manualAvailability(status.capability.unavailableReason);
}

function terminalRetry(operation: HostUpdateOperation | null): boolean {
  return operation?.phase === "rolledBack" || operation?.phase === "failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Companion update request failed";
}
