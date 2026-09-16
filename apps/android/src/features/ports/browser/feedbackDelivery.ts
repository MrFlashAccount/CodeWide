import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { TransferAccess } from "../../../data/private-transfer";

export interface FeedbackTarget {
  readonly connectionId: string;
  readonly threadId: string;
}

/** Feedback uses qualified upload access and the existing durable queue admission. */
export interface FeedbackDelivery {
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  sendText: (
    connectionId: string,
    threadId: string,
    text: string,
    mode: { type: "queue" },
    options: { attachments: RemoteFileAttachment[] },
  ) => Promise<string>;
  transferAccess: (connectionId: string) => Promise<TransferAccess>;
}
