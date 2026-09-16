import type { PendingServerRequest } from "../../data/pending-request-types";
/** Qualified capabilities consumed by the requests owner in conversation composition. */
export type ConversationRequestCapabilities = {
  onRespondToRequest:
    | ((request: PendingServerRequest, result: unknown) => Promise<void>)
    | undefined;
  pendingRequest: PendingServerRequest | null;
  pendingRequestCount: number;
};
