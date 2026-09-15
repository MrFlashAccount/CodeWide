import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
/** Qualified queue operations; transport and persisted state stay with their existing lower owners. */
export type QueueWorkspaceCapabilities = {
  listQueuedPrompts(connectionId: string, threadId: string): Promise<QueuedPrompt[]>;
  editQueuedPrompt(
    connectionId: string,
    commandId: string,
    text: string,
    attachments: RemoteFileAttachment[],
  ): Promise<void>;
  cancelQueuedPrompt(connectionId: string, commandId: string): Promise<void>;
  moveQueuedPrompt(
    connectionId: string,
    threadId: string,
    commandId: string,
    direction: -1 | 1,
  ): Promise<void>;
  steerQueuedPrompt(connectionId: string, commandId: string, expectedTurnId: string): Promise<void>;
};
