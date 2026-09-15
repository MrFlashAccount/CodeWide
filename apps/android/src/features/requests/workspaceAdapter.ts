import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import type { PendingRequestDatabase } from "../../data/pending-request-database";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { enqueueNativeCommand } from "../../native/native-transport";

import type { RequestsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts requests intents using retained lower authorities. */
export function createRequestsWorkspaceAdapter({
  getPendingRequests,
}: {
  getPendingRequests(): PendingRequestDatabase | null;
}): RequestsWorkspaceCapabilities {
  const respondToServerRequest = async (
    request: PendingServerRequest,
    result: unknown,
  ): Promise<void> => {
    const pending = getPendingRequests();
    if (pending === null || !pending.claim(request.connectionId, request.requestKey)) return;
    try {
      const requestHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, request.requestKey);
      await enqueueNativeCommand(
        request.connectionId,
        `server-response-${requestHash}`,
        "serverRequest/respond",
        { requestId: request.requestId, result },
      );
    } catch (cause) {
      pending.release(request.connectionId, request.requestKey);
      throw cause;
    }
  };
  return { respondToServerRequest };
}
