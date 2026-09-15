import { MAX_TURN_TEXT_CHARS, type RemoteFileAttachment } from "@codewide/sync-client";
import { randomUUID } from "expo-crypto";
import { runOptimisticPendingMutation } from "../../data/command-delivery";
import { parseHostQueueSnapshot } from "../../data/queue-event";
import { queuedInputPayload } from "../../data/queued-input";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import { enqueueNativeCommand, listNativeCommands } from "../../native/native-transport";

import type { QueueWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts queue intents using retained lower authorities. */
export function createQueueWorkspaceAdapter({
  getDetails,
  getSession,
  rpcAfterAttach,
}: {
  getDetails(): ThreadDetailDatabase | null;
  getSession(connectionId: string): WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): QueueWorkspaceCapabilities {
  const listQueuedPrompts = async (
    connectionId: string,
    threadId: string,
  ): Promise<QueuedPrompt[]> => {
    const details = getDetails();
    if (details === null) return [];
    const session = getSession(connectionId);
    if (session !== undefined) {
      try {
        const mirrored = await rpcAfterAttach<{ data: unknown }>(session, "companion/queue/list", {
          threadId,
        });
        const commands = parseHostQueueSnapshot(mirrored.data);
        if (commands === null) throw new Error("Companion queue snapshot is invalid");
        const nativeCommands = await listNativeCommands();
        const pending = new Set(
          nativeCommands
            .filter(
              (delivery) =>
                delivery.connectionId === connectionId &&
                delivery.method === "companion/queue/put" &&
                delivery.state !== "delivered",
            )
            .flatMap((delivery) =>
              delivery.targetCommandId === null ? [] : [delivery.targetCommandId],
            ),
        );
        await details.replaceQueued(connectionId, threadId, commands, pending);
      } catch {
        // The persisted Legend chat projection remains available offline.
      }
    }
    return details
      .listQueued(connectionId, threadId)
      .filter(({ state }) => state !== "delivered")
      .map(({ commandId, text, attachments, createdAt, state, lastError }) => ({
        commandId,
        text,
        attachments,
        createdAt,
        state: state === "failed" || state === "uncertain" ? state : "queued",
        lastError,
      }));
  };

  const editQueuedPrompt = async (
    connectionId: string,
    commandId: string,
    text: string,
    attachments: RemoteFileAttachment[],
  ): Promise<void> => {
    const normalized = text.trim();
    if (normalized.length < 1 && attachments.length === 0)
      throw new Error("Queued message cannot be empty");
    if (normalized.length > MAX_TURN_TEXT_CHARS)
      throw new Error(`Queued message exceeds ${MAX_TURN_TEXT_CHARS} characters`);
    const details = getDetails();
    if (details === null) throw new Error("Local timeline database is not ready");
    const mutation = details.planQueuedEdit(connectionId, commandId, normalized, attachments);
    if (mutation === null)
      throw new Error("Queued prompt is already dispatching or no longer exists");
    await runOptimisticPendingMutation(details, mutation, async () => {
      await enqueueNativeCommand(
        connectionId,
        `queue-edit-${randomUUID()}`,
        "companion/queue/edit",
        {
          commandId,
          text: normalized,
          input: queuedInputPayload(normalized, attachments),
        },
      );
    });
  };

  const cancelQueuedPrompt = async (connectionId: string, commandId: string): Promise<void> => {
    const details = getDetails();
    if (details === null) throw new Error("Local timeline database is not ready");
    const mutation = details.planQueuedRemoval(connectionId, commandId);
    if (mutation === null)
      throw new Error("Queued prompt is already dispatching or no longer exists");
    await runOptimisticPendingMutation(details, mutation, async () => {
      await enqueueNativeCommand(
        connectionId,
        `queue-cancel-${randomUUID()}`,
        "companion/queue/cancel",
        { commandId },
      );
    });
  };

  const moveQueuedPrompt = async (
    connectionId: string,
    threadId: string,
    commandId: string,
    direction: -1 | 1,
  ): Promise<void> => {
    const details = getDetails();
    if (details === null) throw new Error("Local timeline database is not ready");
    const mutation = details.planQueuedMove(connectionId, threadId, commandId, direction);
    if (mutation === null) return;
    await runOptimisticPendingMutation(details, mutation, async () => {
      await enqueueNativeCommand(
        connectionId,
        `queue-move-${randomUUID()}`,
        "companion/queue/move",
        {
          commandId,
          beforeCommandId: mutation.beforeCommandId ?? null,
        },
      );
    });
  };

  const steerQueuedPrompt = async (
    connectionId: string,
    commandId: string,
    expectedTurnId: string,
  ): Promise<void> => {
    await enqueueNativeCommand(
      connectionId,
      `queue-steer-${randomUUID()}`,
      "companion/queue/steer",
      {
        commandId,
        expectedTurnId,
      },
    );
  };
  return {
    listQueuedPrompts,
    editQueuedPrompt,
    cancelQueuedPrompt,
    moveQueuedPrompt,
    steerQueuedPrompt,
  };
}
