import type { PendingRequestDatabase } from "../../data/pending-request-database";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { deliverServerRequestResponse } from "../../data/serverRequestDelivery";

import type { RequestsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts requests intents using retained lower authorities. */
export function createRequestsWorkspaceAdapter({
  getPendingRequests,
}: {
  getPendingRequests: () => PendingRequestDatabase | null;
}): RequestsWorkspaceCapabilities {
  const respondToServerRequest = async (
    request: PendingServerRequest,
    result: unknown,
  ): Promise<void> => {
    const pending = getPendingRequests();
    if (pending === null || !pending.claim(request.connectionId, request.requestKey)) {
      return;
    }
    try {
      await deliverServerRequestResponse({
        connectionId: request.connectionId,
        requestId: request.requestId,
        responseKey: request.requestKey,
        result,
      });
    } catch (error) {
      pending.release(request.connectionId, request.requestKey);
      throw error;
    }
  };
  return { respondToServerRequest };
}
