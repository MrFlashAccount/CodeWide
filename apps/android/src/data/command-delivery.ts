import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createTextOutboxCommand } from "@codewide/sync-client";
import {
  acknowledgeNativeCommandReceipt,
  enqueueNativeCommand,
  listNativeCommands,
  retryNativeCommand,
  type NativeCommandDelivery,
} from "../native/native-transport";
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
  if (threads.length === 0) return;
  let nativeCommands: NativeCommandDelivery[];
  try {
    nativeCommands = await listNativeCommands();
  } catch (cause) {
    console.warn("Could not inspect native receipts after authoritative projection", cause);
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
    )
      continue;
    const current = rowsByThread.get(threadId);
    if (current === undefined) rowsByThread.set(threadId, [delivery]);
    else current.push(delivery);
  }

  if (rowsByThread.size === 0) return;
  const accepted = new Set<string>();
  for (const thread of threads) {
    const receipts = rowsByThread.get(thread.id);
    if (receipts === undefined) continue;
    const clientIds = new Set<string>();
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (
          item.type === "userMessage" &&
          typeof item.clientId === "string" &&
          item.clientId.length > 0
        )
          clientIds.add(item.clientId);
      }
    }
    for (const delivery of receipts) {
      if (clientIds.has(delivery.commandId)) accepted.add(delivery.commandId);
    }
  }

  const acknowledgements: Promise<void>[] = [];
  for (const commandId of accepted)
    acknowledgements.push(
      (async () => {
        try {
          await acknowledgeNativeCommandReceipt(connectionId, commandId);
        } catch (cause) {
          // The authoritative projection already contains the prompt, so a native
          // receipt cleanup failure must not block frame acknowledgement or render
          // the duplicate again. The bounded native receipt can be retried later.
          console.warn("Native command receipt acknowledgement failed", cause);
        }
      })(),
    );
  await Promise.all(acknowledgements);
}

export async function reconcileActiveThreadCommands(
  details: ThreadDetailDatabase | null,
  connectionId: string,
  threadId: string,
): Promise<boolean> {
  if (details === null) return false;
  try {
    const deliveries = await listNativeCommands();
    await details.reconcileNativeCommands(connectionId, threadId, deliveries);
    // A reopened/hydrated detail window can finish the handoff without another
    // live user-item event (for example, the turn completed while offline).
    const thread = details.getThread(connectionId, threadId);
    if (thread !== null) await reconcileDeliveredCommandReceipts(connectionId, [thread]);
    return hasUnresolvedDeliveredCommand(deliveries, connectionId, threadId, (commandId) =>
      details.hasPendingDelivery(connectionId, threadId, commandId),
    );
  } catch (cause) {
    // The native ledger is authoritative and remains available for the next
    // active-thread refresh. A read-model repair must not make history fail.
    console.warn("Could not reconcile the active thread from the native outbox", cause);
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
      if (!projected)
        console.warn("Accepted queue mutation will be reconciled from the native outbox");
    });
    optimistic.complete();
  } catch (cause) {
    optimistic.rollback();
    throw cause;
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
    if (details === null) throw new Error("Local timeline database is not ready");
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
      connectionId,
      threadId,
      commandId: command.commandId,
      method: command.method,
      presentation,
      workspaceRequestId: options.workspaceRequestId ?? null,
      text,
      attachments: options.attachments ?? [],
      state: "queued",
      attempts: 0,
      lastError: null,
      createdAt: command.createdAt,
      updatedAt: command.createdAt,
    });
    const optimistic = details.stagePendingMutation({ upserts: [pending], deletes: [] });
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
          if (!projected)
            console.warn(
              "Accepted command will be reconciled from the native outbox when the thread becomes active",
            );
        },
      );
      optimistic.complete();
    } catch (cause) {
      optimistic.rollback();
      throw cause;
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
        state: "sending" as const,
        lastError: null,
        updatedAt: Date.now(),
      };
      await commitNativeThenProject(
        async () =>
          await enqueueNativeCommand(
            connectionId,
            `queue-retry-${randomUUID()}`,
            "companion/queue/retry",
            { commandId },
          ),
        async () => await details?.applyCommandDelivery(retrying),
      );
      return;
    }
    await commitNativeThenProject(
      async () => await retryNativeCommand(connectionId, commandId),
      async (delivery) => await details?.applyCommandDelivery(delivery),
    );
  };

  return { sendText, retryFailedMessage };
}

/** Projects native delivery notifications independently into their existing view owners. */
export function createCommandDeliveryProjection(
  details: Pick<ThreadDetailDatabase, "applyCommandDelivery">,
  summaries: Pick<ThreadSummaryDatabase, "applyCommandDelivery">,
): (delivery: NativeCommandDelivery) => void {
  return (delivery) => {
    void details.applyCommandDelivery(delivery).catch((cause: unknown) => {
      console.error("Timeline delivery projection failed", { err: cause });
    });
    void summaries.applyCommandDelivery(delivery).catch((cause: unknown) => {
      console.error("Thread delete projection failed", { err: cause });
    });
  };
}
