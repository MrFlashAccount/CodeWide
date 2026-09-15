import type { PendingServerRequest } from "../../data/pending-request-types";
/** Qualified requests operations; transport and persisted state stay with their existing lower owners. */
export type RequestsWorkspaceCapabilities = {
  respondToServerRequest(request: PendingServerRequest, result: unknown): Promise<void>;
};
