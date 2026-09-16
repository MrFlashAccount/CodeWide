import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
/** Qualified queue operations; transport and persisted state stay with their existing lower owners. */
export type QueueWorkspaceCapabilities = {
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
