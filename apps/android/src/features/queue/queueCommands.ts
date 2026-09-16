import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import { useEvent } from "../../react/useEvent";

/** Remote commands available to the queued-prompt feature. */
export type QueueCommands = {
  cancelQueuedPrompt: (connectionId: string, commandId: string) => Promise<void>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  editQueuedPrompt: (
    connectionId: string,
    commandId: string,
    text: string,
    attachments: RemoteFileAttachment[],
  ) => Promise<void>;
  listQueuedPrompts: (connectionId: string, threadId: string) => Promise<QueuedPrompt[]>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  moveQueuedPrompt: (
    connectionId: string,
    threadId: string,
    commandId: string,
    direction: -1 | 1,
  ) => Promise<void>;
  steerQueuedPrompt: (
    connectionId: string,
    commandId: string,
    expectedTurnId: string,
  ) => Promise<void>;
};
export function useQueueCommands(
  remote: QueueCommands,
  activeConnectionId: string,
  activeRemoteThreadId: string | null,
) {
  const requireThreadId = useEvent(() => {
    if (activeRemoteThreadId === null) {
      throw new Error("No thread selected");
    }
    return activeRemoteThreadId;
  });
  const onListQueue = useEvent(async () =>
    remote.listQueuedPrompts(activeConnectionId, requireThreadId()),
  );
  const onEditQueued = useEvent(
    async (commandId: string, text: string, attachments: RemoteFileAttachment[]) => {
      await remote.editQueuedPrompt(activeConnectionId, commandId, text, attachments);
    },
  );
  const onCancelQueued = useEvent(async (commandId: string) => {
    await remote.cancelQueuedPrompt(activeConnectionId, commandId);
  });
  const onMoveQueued = useEvent(async (commandId: string, direction: -1 | 1) => {
    await remote.moveQueuedPrompt(activeConnectionId, requireThreadId(), commandId, direction);
  });
  const onSteerQueued = useEvent(async (commandId: string, expectedTurnId: string) => {
    await remote.steerQueuedPrompt(activeConnectionId, commandId, expectedTurnId);
  });
  return { onCancelQueued, onEditQueued, onListQueue, onMoveQueued, onSteerQueued };
}
