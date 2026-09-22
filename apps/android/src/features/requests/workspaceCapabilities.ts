import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { SendMode } from "../../data/thread-delivery-state";
import type { PendingServerRequest } from "../../data/pending-request-types";
/** Qualified requests operations; transport and persisted state stay with their existing lower owners. */
export type RequestsWorkspaceCapabilities = {
  getQuestionSummaries: () => ThreadSummaryDatabase | null;
  respondToServerRequest: (request: PendingServerRequest, result: unknown) => Promise<void>;
  sendQuestionAnswer: (request: {
    readonly commandId: string;
    readonly connectionId: string;
    readonly mode: SendMode;
    readonly retry: boolean;
    readonly text: string;
    readonly threadId: string;
  }) => Promise<void>;
};
