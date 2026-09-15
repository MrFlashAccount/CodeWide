import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
/** Qualified capabilities consumed by the queue owner in conversation composition. */
export type QueueWorkspaceCapabilities = {
  queuedPrompts: QueuedPrompt[];
  onListQueue: (() => Promise<QueuedPrompt[]>) | undefined;
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  onCancelQueued: ((commandId: string) => Promise<void>) | undefined;
  onMoveQueued: ((commandId: string, direction: -1 | 1) => Promise<void>) | undefined;
  onSteerQueued: ((commandId: string, expectedTurnId: string) => Promise<void>) | undefined;
};
