import type { createCommandDelivery } from "../../data/command-delivery";
import { listNativeCommands } from "../../native/native-transport";
import type { PendingRequestDatabase } from "../../data/pending-request-database";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { deliverServerRequestResponse } from "../../data/serverRequestDelivery";

import type { RequestsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts requests intents using retained lower authorities. */
export function createRequestsWorkspaceAdapter({
  delivery,
  getPendingRequests,
  getSummaries,
}: {
  delivery: Pick<ReturnType<typeof createCommandDelivery>, "deliverText" | "retryFailedMessage">;
  getPendingRequests: () => PendingRequestDatabase | null;
  getSummaries: RequestsWorkspaceCapabilities["getQuestionSummaries"];
}): RequestsWorkspaceCapabilities {
  const respondToServerRequest = async (
    request: PendingServerRequest,
    result: unknown,
  ): Promise<void> => {
    const pending = getPendingRequests();
    if (pending === null || !pending.claim(request.connectionId, request.requestKey)) {
      throw new Error("Request is no longer available for a response");
    }
    try {
      await deliverServerRequestResponse({
        connectionId: request.connectionId,
        requestId: request.requestId,
        responseKey:
          request.method === "item/tool/requestUserInput"
            ? JSON.stringify([request.requestKey, request.createdAt])
            : request.requestKey,
        result,
      });
    } catch (error) {
      pending.release(request.connectionId, request.requestKey);
      throw error;
    }
  };
  const sendQuestionAnswer: RequestsWorkspaceCapabilities["sendQuestionAnswer"] = async (
    request,
  ) => {
    if (request.retry) {
      const original = (await listNativeCommands()).find(
        (command) =>
          command.connectionId === request.connectionId && command.commandId === request.commandId,
      );
      if (original !== undefined) {
        if (original.state === "failed") {
          await delivery.retryFailedMessage(request.connectionId, request.commandId);
        }
        return;
      }
    }
    await delivery.deliverText({
      commandId: request.commandId,
      connectionId: request.connectionId,
      mode: request.mode,
      options: {},
      text: request.text,
      threadId: request.threadId,
    });
  };
  return { getQuestionSummaries: getSummaries, respondToServerRequest, sendQuestionAnswer };
}
