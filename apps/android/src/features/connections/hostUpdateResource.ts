import { observable } from "@legendapp/state";

import { isTerminalHostUpdatePhase, type HostUpdateOperation } from "./hostUpdateContract";
import {
  createHostUpdateResourceRecord,
  hostUpdateHttpFailureView,
  hostUpdateOperationView,
  hostUpdateStatusView,
  hostUpdateTransportFailureView,
  INITIAL_HOST_UPDATE_VIEW,
  intentAfterStatus,
  isRejectedHostUpdateApply,
  requireHostUpdateResourceRecord,
  type HostUpdateResource,
  type HostUpdateResourceRecord,
  type HostUpdateSnapshot,
  type UpdateIntent,
  unsupportedHostUpdateView,
} from "./hostUpdateResourceState";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { HostUpdateHttpError, type HostUpdateTransport } from "./hostUpdateTransport";

type HostUpdateResourceOptions = {
  readonly createIdempotencyKey: () => string;
  readonly idempotencyPrefix?: string;
  readonly retryBaseMilliseconds?: number;
  readonly subject?: string;
  readonly transport: HostUpdateTransport;
};

const DEFAULT_RETRY_MILLISECONDS = 1000;
const RETRY_MULTIPLIER = 2;
const MAX_RETRY_MILLISECONDS = 8000;
const NOT_FOUND_STATUS = 404;

type TransportFailureInput = {
  readonly connectionId: string;
  readonly error: unknown;
  readonly preserveIntent: boolean;
  readonly record: HostUpdateResourceRecord;
};

function cancelTimer(record: HostUpdateResourceRecord): void {
  if (record.timer !== null) {
    clearTimeout(record.timer);
    record.timer = null;
  }
}

/**
 * Process-lifetime owner for host update reads and intents.
 *
 * The resource deliberately retains an apply idempotency key while Companion
 * restarts. A lost HTTP 202 is recovered by resending the exact same intent.
 */
export function createHostUpdateResource({
  createIdempotencyKey,
  idempotencyPrefix = "host-update",
  retryBaseMilliseconds = DEFAULT_RETRY_MILLISECONDS,
  subject = "Companion",
  transport,
}: HostUpdateResourceOptions): HostUpdateResource {
  const snapshot$ = observable<HostUpdateSnapshot>({ byConnection: {} });
  const records = new Map<string, HostUpdateResourceRecord>();

  const publish = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    view: HostUpdateView,
  ): void => {
    if (records.get(connectionId) !== record) {
      return;
    }
    const projected = record.connected
      ? view
      : {
          ...view,
          canApply: false,
          canCheck: false,
          disconnected: record.intent !== null,
        };
    record.view = projected;
    snapshot$.byConnection.assign({ [connectionId]: projected });
  };

  const scheduleReconcile = (connectionId: string, record: HostUpdateResourceRecord): void => {
    if (
      records.get(connectionId) !== record ||
      !record.connected ||
      record.timer !== null ||
      record.busy
    ) {
      return;
    }
    const delay = Math.min(
      retryBaseMilliseconds * RETRY_MULTIPLIER ** record.retryAttempt,
      MAX_RETRY_MILLISECONDS,
    );
    record.retryAttempt += 1;
    record.timer = setTimeout(() => {
      record.timer = null;
      reconcile(connectionId, record).catch(() => undefined);
    }, delay);
  };

  const publishTransportFailure = ({
    connectionId,
    error,
    preserveIntent,
    record,
  }: TransportFailureInput): void => {
    if (
      !(error instanceof HostUpdateHttpError) ||
      (preserveIntent && !isRejectedHostUpdateApply(record, error))
    ) {
      publish(
        connectionId,
        record,
        hostUpdateTransportFailureView(record.view, error, preserveIntent),
      );
      if (preserveIntent) {
        scheduleReconcile(connectionId, record);
      }
      return;
    }
    if (error.status === NOT_FOUND_STATUS && record.intent === null) {
      publish(connectionId, record, unsupportedHostUpdateView(record.view));
      return;
    }
    record.intent = null;
    publish(connectionId, record, hostUpdateHttpFailureView(record.view, error));
  };

  const publishOperation = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    operation: HostUpdateOperation,
  ): void => {
    publish(connectionId, record, hostUpdateOperationView(record.view, operation));
  };

  const readFreshStatus = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
  ): Promise<void> => {
    const status = await transport.readStatus(connectionId);
    record.loaded = true;
    record.retryAttempt = 0;
    record.intent = intentAfterStatus(record.intent, status);
    publish(connectionId, record, hostUpdateStatusView(status));
    if (
      status.activeOperation !== null &&
      !isTerminalHostUpdatePhase(status.activeOperation.phase)
    ) {
      await reconcileKnownOperation(connectionId, record, status.activeOperation);
    }
  };

  const recoverLostAcceptance = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
    intent: UpdateIntent,
  ): Promise<void> => {
    if (intent.idempotencyKey.length === 0) {
      await readFreshStatus(connectionId, record);
      return;
    }
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
      phase: accepted.phase,
    });
    scheduleReconcile(connectionId, record);
  };

  const resolveOperation = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
    known?: HostUpdateOperation,
  ): Promise<HostUpdateOperation | null> => {
    if (known !== undefined) {
      return known;
    }
    const operationId = record.intent?.operationId;
    if (operationId !== null && operationId !== undefined) {
      const operation = await transport.readOperation(connectionId, operationId);
      record.retryAttempt = 0;
      return operation;
    }
    const intent = record.intent;
    if (intent !== null) {
      await recoverLostAcceptance(connectionId, record, intent);
    }
    return null;
  };

  const acknowledgeReconnect = async (
    connectionId: string,
    operation: HostUpdateOperation,
  ): Promise<HostUpdateOperation> =>
    operation.phase === "awaitingReconnect"
      ? transport.reconnect(connectionId, operation.operationId)
      : operation;

  const reconcileKnownOperation = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
    known?: HostUpdateOperation,
  ): Promise<void> => {
    const loadedOperation = await resolveOperation(connectionId, record, known);
    if (loadedOperation === null) {
      return;
    }
    publishOperation(connectionId, record, loadedOperation);
    const operation = await acknowledgeReconnect(connectionId, loadedOperation);
    if (operation !== loadedOperation) {
      publishOperation(connectionId, record, operation);
    }
    if (isTerminalHostUpdatePhase(operation.phase)) {
      record.intent = null;
      try {
        await readFreshStatus(connectionId, record);
      } catch {
        publish(connectionId, record, {
          ...record.view,
          canCheck: record.connected,
        });
      }
      return;
    }
    scheduleReconcile(connectionId, record);
  };

  const recordIsCurrent = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    generation: number,
  ): boolean => records.get(connectionId) === record && record.generation === generation;

  const runReconcile = async (
    connectionId: string,
    record: HostUpdateResourceRecord,
  ): Promise<void> => {
    if (record.intent === null) {
      await readFreshStatus(connectionId, record);
      return;
    }
    await reconcileKnownOperation(connectionId, record);
  };

  const finishReconcile = (connectionId: string, record: HostUpdateResourceRecord): void => {
    record.busy = false;
    if (record.intent !== null) {
      scheduleReconcile(connectionId, record);
    }
  };

  async function reconcile(connectionId: string, record: HostUpdateResourceRecord): Promise<void> {
    if (!record.connected || record.busy) {
      return;
    }
    cancelTimer(record);
    record.busy = true;
    const generation = record.generation;
    try {
      await runReconcile(connectionId, record);
    } catch (error) {
      if (recordIsCurrent(connectionId, record, generation)) {
        publishTransportFailure({
          connectionId,
          error,
          preserveIntent: record.intent !== null,
          record,
        });
      }
    } finally {
      if (recordIsCurrent(connectionId, record, generation)) {
        finishReconcile(connectionId, record);
      }
    }
  }

  const observeDisconnected = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    justDisconnected: boolean,
  ): void => {
    cancelTimer(record);
    if (record.intent !== null && !record.view.disconnected) {
      publish(connectionId, record, { ...record.view, disconnected: true });
      return;
    }
    if (record.intent === null && justDisconnected) {
      publish(connectionId, record, {
        ...record.view,
        canApply: false,
        canCheck: false,
      });
    }
  };

  const resource: HostUpdateResource = {
    async apply(connectionId, targetFingerprint) {
      const record = requireHostUpdateResourceRecord(records, connectionId);
      if (
        record.intent !== null ||
        !record.view.canApply ||
        record.view.targetFingerprint !== targetFingerprint
      ) {
        if (record.view.targetFingerprint !== targetFingerprint) {
          publish(connectionId, record, {
            ...record.view,
            canApply: false,
            canCheck: true,
            errorCode: "stale_target",
            errorMessage: `The available ${subject} release changed. Check again before updating.`,
          });
        }
        return;
      }
      record.intent = {
        idempotencyKey: `${idempotencyPrefix}-${createIdempotencyKey()}`,
        operationId: null,
        targetFingerprint,
      };
      publish(connectionId, record, {
        ...record.view,
        canApply: false,
        canCheck: false,
        canRetry: false,
        disconnected: false,
        errorCode: null,
        errorMessage: null,
        phase: "accepted",
      });
      await reconcile(connectionId, record);
    },
    async check(connectionId) {
      const record = requireHostUpdateResourceRecord(records, connectionId);
      if (!record.connected || record.busy || record.intent !== null) {
        return;
      }
      record.busy = true;
      publish(connectionId, record, {
        ...record.view,
        canApply: false,
        canCheck: false,
        errorCode: null,
        errorMessage: null,
      });
      try {
        const status = await transport.check(connectionId);
        record.loaded = true;
        record.retryAttempt = 0;
        record.intent = intentAfterStatus(record.intent, status);
        publish(connectionId, record, hostUpdateStatusView(status));
      } catch (error) {
        publishTransportFailure({ connectionId, error, preserveIntent: false, record });
      } finally {
        record.busy = false;
      }
    },
    forget(connectionId) {
      const record = records.get(connectionId);
      if (record !== undefined) {
        cancelTimer(record);
        record.generation += 1;
        records.delete(connectionId);
        snapshot$.byConnection[connectionId]?.delete();
      }
    },
    observe(connectionId, connected) {
      const existing = records.get(connectionId);
      const record = existing ?? createHostUpdateResourceRecord(connected);
      if (existing === undefined) {
        records.set(connectionId, record);
        publish(connectionId, record, INITIAL_HOST_UPDATE_VIEW);
      }
      const reconnected = !record.connected && connected;
      const disconnected = record.connected && !connected;
      record.connected = connected;
      if (!connected) {
        observeDisconnected(connectionId, record, disconnected);
        return;
      }
      if (!record.loaded || reconnected) {
        reconcile(connectionId, record).catch(() => undefined);
      }
    },
    snapshot$,
  };
  return resource;
}
