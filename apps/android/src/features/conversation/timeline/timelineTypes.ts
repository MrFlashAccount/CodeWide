/** V1 timelineTypes owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { VisiblePendingDeliveryState } from "../../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";

export type TimelineItem =
  | {
      kind: "turn";
      id: string;
      key: string;
      connectionId: string;
      threadId: string;
      scope: string;
      turn: Thread["turns"][number];
    }
  | {
      kind: "optimistic";
      scope: string;
      id: string;
      text: string;
      attachments: StoredDraftAttachment[];
      status: VisiblePendingDeliveryState;
      workspaceRequestId?: string | null;
      lastError: string | null;
      createdAt: number;
    }
  | {
      kind: "meta";
      key: string;
      status: "completed" | "interrupted" | "failed" | "inProgress";
      durationMs: number | null;
      completedAt: number | null;
    };
