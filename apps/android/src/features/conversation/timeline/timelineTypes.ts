/** V1 timelineTypes owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { VisiblePendingDeliveryState } from "../../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";

export type TimelineItem =
  | {
      connectionId: string;
      id: string;
      key: string;
      kind: "turn";
      scope: string;
      threadId: string;
      turn: Thread["turns"][number];
    }
  | {
      attachments: StoredDraftAttachment[];
      createdAt: number;
      id: string;
      kind: "optimistic";
      lastError: string | null;
      scope: string;
      status: VisiblePendingDeliveryState;
      text: string;
      workspaceRequestId?: string | null;
    }
  | {
      completedAt: number | null;
      durationMs: number | null;
      key: string;
      kind: "meta";
      status: "completed" | "interrupted" | "failed" | "inProgress";
    };
