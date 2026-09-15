import type { PendingServerRequest } from "../../data/pending-request-types";
/** Qualified capabilities consumed by the requests owner in conversation composition. */
export type ConversationRequestCapabilities = {
  pendingRequest: PendingServerRequest | null;
  pendingRequestCount: number;
  onRespondToRequest:
    | ((request: PendingServerRequest, result: unknown) => Promise<void>)
    | undefined;
};
