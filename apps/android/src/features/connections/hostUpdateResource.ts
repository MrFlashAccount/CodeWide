import { observable } from "@legendapp/state";

import { isTerminalHostUpdatePhase } from "./hostUpdateContract";
import { createHostUpdateFollower } from "./hostUpdateOperationFollower";
import {
  createHostUpdateResourceRecord,
  hostUpdateHttpFailureView,
  hostUpdateStatusView,
  hostUpdateTransportFailureView,
  hostUpdateWaitingView,
  INITIAL_HOST_UPDATE_VIEW,
  intentAfterStatus,
  isRejectedHostUpdateApply,
  isTransientHostUpdateFailure,
  requireHostUpdateResourceRecord,
  type HostUpdateResource,
  type HostUpdateResourceRecord,
  type HostUpdateSnapshot,
  unsupportedHostUpdateView,
} from "./hostUpdateResourceState";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { HostUpdateHttpError, type HostUpdateTransport } from "./hostUpdateTransport";

type HostUpdateResourceOptions = {
  readonly createIdempotencyKey: () => string;
  readonly idempotencyPrefix?: string;
  readonly now?: () => number;
  readonly retryBaseMilliseconds?: number;
  readonly subject?: string;
  readonly transport: HostUpdateTransport;
};

const DEFAULT_RETRY_MILLISECONDS = 1000;
const RETRY_MULTIPLIER = 2;
const MAX_RETRY_MILLISECONDS = 8000;
// Demand older than this rereads the server: Companion or Relay may have been
// updated or restarted while no settings surface observed the connection.
const STATUS_FRESH_MILLISECONDS = 30_000;
// A restarting Companion or Relay is unreachable or answers 503 for several
// seconds. Within this window a failed background read keeps the last
// confirmed status and retries; after it the failure is shown.
const TRANSIENT_GRACE_MILLISECONDS = 60_000;
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
 * One request runs per connection at a time: a check requested meanwhile runs
 * right after it, and an apply registered meanwhile is sent right after it.
 */
export function createHostUpdateResource({
  createIdempotencyKey,
  idempotencyPrefix = "host-update",
  now = Date.now,
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
    const terminal = projected.phase !== null && isTerminalHostUpdatePhase(projected.phase);
    if (!terminal) {
      record.terminalShownAt = null;
    } else if (record.view.phase !== projected.phase || record.terminalShownAt === null) {
      record.terminalShownAt = now();
    }
    record.view = projected;
    snapshot$.byConnection.assign({ [connectionId]: projected });
  };

  const scheduleReconcile = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    immediate = false,
  ): void => {
    if (
      records.get(connectionId) !== record ||
      !record.connected ||
      record.timer !== null ||
      record.busy
    ) {
      return;
    }
    let delay = 0;
    if (!immediate) {
      delay = Math.min(
        retryBaseMilliseconds * RETRY_MULTIPLIER ** record.retryAttempt,
        MAX_RETRY_MILLISECONDS,
      );
      record.retryAttempt += 1;
    }
    record.timer = setTimeout(() => {
      record.timer = null;
      reconcile(connectionId, record).catch(() => undefined);
    }, delay);
  };

  const follower = createHostUpdateFollower({ now, publish, scheduleReconcile, transport });

  /** A background read that could not reach the server keeps the last confirmed status. */
  const waitAfterTransientFailure = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    error: unknown,
  ): boolean => {
    if (!isTransientHostUpdateFailure(error) || record.view.currentVersion === null) {
      return false;
    }
    record.transientSince ??= now();
    if (now() - record.transientSince >= TRANSIENT_GRACE_MILLISECONDS) {
      return false;
    }
    publish(connectionId, record, hostUpdateWaitingView(record.view));
    return true;
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
      return;
    }
    if (error.status === NOT_FOUND_STATUS && record.intent === null) {
      publish(connectionId, record, unsupportedHostUpdateView(record.view));
      return;
    }
    record.intent = null;
    publish(connectionId, record, hostUpdateHttpFailureView(record.view, error));
  };

  const publishReconcileFailure = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    error: unknown,
  ): void => {
    const preserveIntent = record.intent !== null;
    if (preserveIntent || !waitAfterTransientFailure(connectionId, record, error)) {
      publishTransportFailure({ connectionId, error, preserveIntent, record });
    }
  };

  const recordIsCurrent = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    generation: number,
  ): boolean => records.get(connectionId) === record && record.generation === generation;

  const finishReconcile = (
    connectionId: string,
    record: HostUpdateResourceRecord,
    succeeded: boolean,
  ): void => {
    record.busy = false;
    const queuedCheck = record.queuedCheck;
    record.queuedCheck = null;
    if (record.intent !== null) {
      // An apply registered during another read is sent at once; everything
      // else, including a failed attempt, follows the retry backoff.
      queuedCheck?.resolve(undefined);
      scheduleReconcile(connectionId, record, succeeded && record.intent.operationId === null);
      return;
    }
    if (queuedCheck !== null) {
      const release = () => {
        queuedCheck.resolve(undefined);
      };
      resource.check(connectionId).then(release, release);
      return;
    }
    if (record.view.disconnected) {
      scheduleReconcile(connectionId, record);
    }
  };

  async function reconcile(connectionId: string, record: HostUpdateResourceRecord): Promise<void> {
    if (!record.connected || record.busy) {
      return;
    }
    cancelTimer(record);
    record.busy = true;
    record.lastReadAt = now();
    const generation = record.generation;
    let succeeded = false;
    try {
      await (record.intent === null
        ? follower.readFreshStatus(connectionId, record)
        : follower.followIntent(connectionId, record));
      succeeded = true;
    } catch (error) {
      if (recordIsCurrent(connectionId, record, generation)) {
        publishReconcileFailure(connectionId, record, error);
      }
    } finally {
      if (recordIsCurrent(connectionId, record, generation)) {
        finishReconcile(connectionId, record, succeeded);
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

  // A failed read also counts as recent, so a rerender cannot loop requests.
  const isStale = (record: HostUpdateResourceRecord): boolean =>
    record.lastReadAt === null || now() - record.lastReadAt >= STATUS_FRESH_MILLISECONDS;

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
      // Pending until the server acknowledges the request: the card keeps the
      // confirmed text and shimmers it instead of claiming an accepted update.
      publish(connectionId, record, {
        ...record.view,
        canApply: false,
        canCheck: false,
        canRetry: false,
        disconnected: false,
        errorCode: null,
        errorMessage: null,
        operationId: null,
        pending: "apply",
        phase: null,
        progress: null,
      });
      await reconcile(connectionId, record);
    },
    async check(connectionId) {
      const record = requireHostUpdateResourceRecord(records, connectionId);
      if (!record.connected || record.intent !== null) {
        return;
      }
      publish(connectionId, record, {
        ...record.view,
        canApply: false,
        canCheck: false,
        errorCode: null,
        errorMessage: null,
        pending: "check",
      });
      if (record.busy) {
        record.queuedCheck ??= Promise.withResolvers<undefined>();
        await record.queuedCheck.promise;
        return;
      }
      cancelTimer(record);
      record.busy = true;
      record.lastReadAt = now();
      const generation = record.generation;
      try {
        const status = await transport.check(connectionId);
        record.retryAttempt = 0;
        record.transientSince = null;
        record.intent = intentAfterStatus(record.intent, status);
        publish(connectionId, record, hostUpdateStatusView(status));
      } catch (error) {
        publishTransportFailure({ connectionId, error, preserveIntent: false, record });
      } finally {
        if (recordIsCurrent(connectionId, record, generation)) {
          record.busy = false;
        }
      }
    },
    forget(connectionId) {
      const record = records.get(connectionId);
      if (record !== undefined) {
        cancelTimer(record);
        record.generation += 1;
        record.queuedCheck?.resolve(undefined);
        record.queuedCheck = null;
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
      if (reconnected || isStale(record)) {
        reconcile(connectionId, record).catch(() => undefined);
      }
    },
    snapshot$,
  };
  return resource;
}
