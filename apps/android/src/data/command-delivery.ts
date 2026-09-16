import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createTextOutboxCommand } from "@codewide/sync-client";
import {
  acknowledgeNativeCommandReceipt,
  enqueueNativeCommand,
  listNativeCommands,
  retryNativeCommand,
  type NativeCommandDelivery,
} from "../native/native-transport";
import { appLogger } from "../observability/logger";
import { commitNativeThenProject } from "./durable-command-boundary";
import { hasUnresolvedDeliveredCommand } from "./queue-event";
import type { SendMode, TurnSendOptions } from "./thread-delivery-state";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { PendingTimelineMutation } from "./thread-detail-projection";
import type { ThreadSummaryDatabase } from "./thread-summary-database";

export async function reconcileDeliveredCommandReceipts(
  connectionId: string,
  threads: readonly Thread[],
): Promise<void> {
  if (threads.length === 0) {
    return;
  }
  let nativeCommands: NativeCommandDelivery[];
  try {
    nativeCommands = await listNativeCommands();
  } catch (error) {
    appLogger.warnCaught({ error: error, event: "command_receipt.inspect.failed" });
    return;
  }
  const rowsByThread = new Map<string, NativeCommandDelivery[]>();
  for (const delivery of nativeCommands) {
    const threadId = delivery.threadId;
    if (
      delivery.connectionId !== connectionId ||
      delivery.state !== "delivered" ||
      (delivery.method !== "turn/start" && delivery.method !== "turn/steer") ||
      threadId === null
    ) {
      continue;
    }
    const current = rowsByThread.get(threadId);
    if (current === undefined) {
      rowsByThread.set(threadId, [delivery]);
    } else {
      current.push(delivery);
    }
  }

  if (rowsByThread.size === 0) {
    return;
  }
  const accepted = new Set<string>();
  for (const thread of threads) {
    const receipts = rowsByThread.get(thread.id);
    if (receipts === undefined) {
      continue;
    }
    const clientIds = new Set<string>();
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (
          item.type === "userMessage" &&
          typeof item.clientId === "string" &&
          item.clientId.length > 0
        ) {
          clientIds.add(item.clientId);
        }
      }
    }
    for (const delivery of receipts) {
      if (clientIds.has(delivery.commandId)) {
        accepted.add(delivery.commandId);
      }
    }
  }

  const acknowledgements: Promise<void>[] = [];
  for (const commandId of accepted) {
    acknowledgements.push(
      (async () => {
        try {
          await acknowledgeNativeCommandReceipt(connectionId, commandId);
        } catch (error) {
          // The authoritative projection already contains the prompt, so a native
          // receipt cleanup failure must not block frame acknowledgement or render
          // the duplicate again. The bounded native receipt can be retried later.
          appLogger.warnCaught({ error: error, event: "command_receipt.acknowledge.failed" });
        }
      })(),
    );
  }
  await Promise.all(acknowledgements);
}

export async function reconcileActiveThreadCommands(
  details: ThreadDetailDatabase | null,
  connectionId: string,
  threadId: string,
): Promise<boolean> {
  if (details === null) {
    return false;
  }
  try {
    const deliveries = await listNativeCommands();
    await details.reconcileNativeCommands(connectionId, threadId, deliveries);
    // A reopened/hydrated detail window can finish the handoff without another
    // live user-item event (for example, the turn completed while offline).
    const thread = details.getThread(connectionId, threadId);
    if (thread !== null) {
      await reconcileDeliveredCommandReceipts(connectionId, [thread]);
    }
    return hasUnresolvedDeliveredCommand(deliveries, connectionId, threadId, (commandId) =>
      details.hasPendingDelivery(connectionId, threadId, commandId),
    );
  } catch (error) {
    // The native ledger is authoritative and remains available for the next
    // active-thread refresh. A read-model repair must not make history fail.
    appLogger.warnCaught({ error: error, event: "command_outbox.active_thread_reconcile.failed" });
    return false;
  }
}

export async function runOptimisticPendingMutation(
  details: ThreadDetailDatabase,
  mutation: PendingTimelineMutation,
  persistNative: () => Promise<void>,
): Promise<void> {
  const optimistic = details.stagePendingMutation(mutation);
  try {
    // The optimistic layer may roll back only before Kotlin has durably
    // accepted the command. After that point the native outbox owns recovery.
    await commitNativeThenProject(persistNative, async () => {
      const projected = await details.commitPendingMutation(mutation);
      if (!projected) {
        appLogger.warn({ event: "queue_mutation.projection.deferred" });
      }
    });
    optimistic.complete();
  } catch (error) {
    optimistic.rollback();
    throw error;
  }
}

/** Native admission and optimistic reconciliation share one durable boundary. */
export function createCommandDelivery(
  getDetails: () => ThreadDetailDatabase | null,
  randomUUID: () => string,
) {
  const sendText = async (
    connectionId: string,
    threadId: string,
    text: string,
    mode: SendMode = { type: "start" },
    options: TurnSendOptions = {},
  ): Promise<string> => {
    const details = getDetails();
    if (details === null) {
      throw new Error("Local timeline database is not ready");
    }
    const command = createTextOutboxCommand(
      connectionId,
      threadId,
      text,
      mode,
      options,
      `android-${randomUUID()}`,
    );
    const presentation = mode.type === "queue" ? ("queue" as const) : ("delivery" as const);
    const pending = details.createPending({
      attachments: options.attachments ?? [],
      attempts: 0,
      commandId: command.commandId,
      connectionId,
      createdAt: command.createdAt,
      lastError: null,
      method: command.method,
      presentation,
      state: "queued",
      text,
      threadId,
      updatedAt: command.createdAt,
      workspaceRequestId: options.workspaceRequestId ?? null,
    });
    const optimistic = details.stagePendingMutation({ deletes: [], upserts: [pending] });
    try {
      await commitNativeThenProject(
        async () => {
          if (presentation === "queue" || options.workspaceRequestId !== undefined) {
            await enqueueNativeCommand(
              connectionId,
              `queue-put-${randomUUID()}`,
              "companion/queue/put",
              {
                command: {
                  ...command,
                  presentation,
                  ...(options.workspaceRequestId === undefined
                    ? {}
                    : { workspaceRequestId: options.workspaceRequestId }),
                },
              },
            );
          } else {
            await enqueueNativeCommand(
              connectionId,
              command.commandId,
              command.method,
              command.params,
            );
          }
        },
        async () => {
          const projected = await details.commitPending(
            {
              ...pending,
              pending:
                pending.pending === null || pending.pending === undefined
                  ? null
                  : pending.pending.confirmation !== undefined
                    ? pending.pending
                    : { ...pending.pending, state: "queued", updatedAt: Date.now() },
            },
            { durable: true },
          );
          if (!projected) {
            appLogger.warn({
              event: "command.projection.deferred_until_thread_active",
            });
          }
        },
      );
      optimistic.complete();
    } catch (error) {
      optimistic.rollback();
      throw error;
    }
    return command.commandId;
  };
  const retryFailedMessage = async (connectionId: string, commandId: string): Promise<void> => {
    const details = getDetails();
    const original = (await listNativeCommands()).find(
      (delivery) => delivery.connectionId === connectionId && delivery.commandId === commandId,
    );
    if (original?.method === "turn/start" && original.state === "failed") {
      const retrying = {
        ...original,
        lastError: null,
        state: "sending" as const,
        updatedAt: Date.now(),
      };
      await commitNativeThenProject(
        async () => {
          await enqueueNativeCommand(
            connectionId,
            `queue-retry-${randomUUID()}`,
            "companion/queue/retry",
            { commandId },
          );
        },
        async () => details?.applyCommandDelivery(retrying),
      );
      return;
    }
    await commitNativeThenProject(
      async () => retryNativeCommand(connectionId, commandId),
      async (delivery) => details?.applyCommandDelivery(delivery),
    );
  };

  return { retryFailedMessage, sendText };
}

/** Projects native delivery notifications independently into their existing view owners. */
export function createCommandDeliveryProjection(
  details: Pick<ThreadDetailDatabase, "applyCommandDelivery">,
  summaries: Pick<ThreadSummaryDatabase, "applyCommandDelivery">,
): (delivery: NativeCommandDelivery) => void {
  return (delivery) => {
    void details.applyCommandDelivery(delivery).catch((error: unknown) => {
      appLogger.errorCaught({ error: error, event: "timeline.delivery_projection.failed" });
    });
    void summaries.applyCommandDelivery(delivery).catch((error: unknown) => {
      appLogger.errorCaught({ error: error, event: "thread_delete.delivery_projection.failed" });
    });
  };
}
