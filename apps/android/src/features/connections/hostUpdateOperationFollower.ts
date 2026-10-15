import { isTerminalHostUpdatePhase, type HostUpdateOperation } from "./hostUpdateContract";
import {
  hostUpdateOperationView,
  hostUpdateStatusView,
  intentAfterStatus,
  pendingApplyView,
  type HostUpdateResourceRecord,
  type UpdateIntent,
} from "./hostUpdateResourceState";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import type { HostUpdateTransport } from "./hostUpdateTransport";

// One hour, matching the Linux guardian's retention of a terminal outcome:
// after this a status read without that outcome no longer keeps the locally
// shown result.
const RETAINED_TERMINAL_MILLISECONDS = 3_600_000;

type HostUpdateFollowerOptions = {
  readonly now: () => number;
  readonly publish: (
    connectionId: string,
    record: HostUpdateResourceRecord,
    view: HostUpdateView,
  ) => void;
  readonly scheduleReconcile: (connectionId: string, record: HostUpdateResourceRecord) => void;
  readonly transport: HostUpdateTransport;
};

/** Server reads that move one record towards the authoritative status and operation. */
export type HostUpdateFollower = {
  /** Follows the record's update intent: sends an unacknowledged apply or reads its operation. */
  readonly followIntent: (connectionId: string, record: HostUpdateResourceRecord) => Promise<void>;
  /** Reads status, then follows an active operation it reports. */
  readonly readFreshStatus: (
    connectionId: string,
    record: HostUpdateResourceRecord,
  ) => Promise<void>;
};

/**
 * Some older guardians omit completed operations from status. A status
 * refresh must not erase the terminal result we just read by operation id,
 * but that result expires like the guardian's own retention.
 */
function retainsTerminalOutcome(
  record: HostUpdateResourceRecord,
  status: HostUpdateView,
  now: number,
): boolean {
  return (
    status.phase === null &&
    record.view.phase !== null &&
    isTerminalHostUpdatePhase(record.view.phase) &&
    record.terminalShownAt !== null &&
    now - record.terminalShownAt < RETAINED_TERMINAL_MILLISECONDS
  );
}

/**
 * Owns the request sequence of one reconcile pass. It publishes every
 * confirmed server answer; scheduling, failures and fencing stay with the
 * resource that invokes it.
 */
export function createHostUpdateFollower({
  now,
  publish,
  scheduleReconcile,
  transport,
}: HostUpdateFollowerOptions): HostUpdateFollower {
  const statusViewForRecord = (record: HostUpdateResourceRecord, view: HostUpdateView) => {
    if (record.intent !== null && record.intent.operationId === null) {
      return pendingApplyView(view);
    }
    if (record.queuedCheck !== null) {
      // The check the user asked for runs next; keep showing it as pending.
      return { ...view, canApply: false, canCheck: false, pending: "check" as const };
    }
    return retainsTerminalOutcome(record, view, now())
      ? {
          ...view,
          canRetry: record.view.canRetry,
          errorCode: record.view.errorCode,
          errorMessage: record.view.errorMessage,
          operationId: record.view.operationId,
          phase: record.view.phase,
        }
      : view;
  };

  const readFreshStatus = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
  ): Promise<void> => {
    const status = await transport.readStatus(connectionId);
    record.retryAttempt = 0;
    record.transientSince = null;
    record.intent = intentAfterStatus(record.intent, status);
    publish(connectionId, record, statusViewForRecord(record, hostUpdateStatusView(status)));
    if (
      status.activeOperation !== null &&
      !isTerminalHostUpdatePhase(status.activeOperation.phase)
    ) {
      await followOperation(connectionId, record, status.activeOperation);
    }
  };

  const sendApply = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
    intent: UpdateIntent,
  ): Promise<void> => {
    if (intent.idempotencyKey.length === 0) {
      await readFreshStatus(connectionId, record);
      return;
    }
    // A lost 202 is recovered by resending the identical intent: the server
    // replays the idempotency key instead of starting a second update.
    const accepted = await transport.apply(
      connectionId,
      intent.targetFingerprint,
      intent.idempotencyKey,
    );
    record.retryAttempt = 0;
    intent.operationId = accepted.operationId;
    publish(connectionId, record, {
      ...record.view,
      disconnected: false,
      operationId: accepted.operationId,
      pending: null,
      phase: accepted.phase,
    });
    scheduleReconcile(connectionId, record);
  };

  const acknowledgeReconnect = async (
    connectionId: string,
    operation: HostUpdateOperation,
  ): Promise<HostUpdateOperation> =>
    operation.phase === "awaitingReconnect"
      ? transport.reconnect(connectionId, operation.operationId)
      : operation;

  async function followOperation(
    connectionId: string,
    record: HostUpdateResourceRecord,
    loadedOperation: HostUpdateOperation,
  ): Promise<void> {
    publish(connectionId, record, hostUpdateOperationView(record.view, loadedOperation));
    const operation = await acknowledgeReconnect(connectionId, loadedOperation);
    if (operation !== loadedOperation) {
      publish(connectionId, record, hostUpdateOperationView(record.view, operation));
    }
    if (!isTerminalHostUpdatePhase(operation.phase)) {
      scheduleReconcile(connectionId, record);
      return;
    }
    record.intent = null;
    try {
      await readFreshStatus(connectionId, record);
    } catch {
      publish(connectionId, record, { ...record.view, canCheck: record.connected });
    }
  }

  const followIntent = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
  ): Promise<void> => {
    const intent = record.intent;
    if (intent === null) {
      return;
    }
    if (intent.operationId === null) {
      await sendApply(connectionId, record, intent);
      return;
    }
    const operation = await transport.readOperation(connectionId, intent.operationId);
    record.retryAttempt = 0;
    await followOperation(connectionId, record, operation);
  };

  return { followIntent, readFreshStatus };
}
