import type { RemoteFileAttachment } from "@codewide/sync-client";
import type { TransferAccess } from "../../../data/private-transfer";

export interface FeedbackTarget {
  readonly connectionId: string;
  readonly threadId: string;
}

/** Feedback uses qualified upload access and the existing durable queue admission. */
export interface FeedbackDelivery {
  transferAccess(connectionId: string): Promise<TransferAccess>;
  sendText(
    connectionId: string,
    threadId: string,
    text: string,
    mode: { type: "queue" },
    options: { attachments: RemoteFileAttachment[] },
  ): Promise<string>;
}
