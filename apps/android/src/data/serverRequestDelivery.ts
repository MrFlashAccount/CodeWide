import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

import { enqueueNativeCommand } from "../native/native-transport";
import { globalSupervisorRequestCommandId } from "./globalSupervisorRequestIdentity";
import type { PendingRequestDatabase } from "./pending-request-database-contract";
import type { PendingServerRequest } from "./pending-request-types";

/** Durably settles one App Server request with a content-free idempotency key. */
export async function deliverServerRequestResponse(request: {
  readonly connectionId: string;
  readonly requestId: string | number;
  readonly responseKey?: string;
  readonly result: unknown;
}): Promise<void> {
  const commandId =
    request.responseKey === undefined
      ? await globalSupervisorRequestCommandId("response", request)
      : `server-response-${await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          request.responseKey,
        )}`;
  await enqueueNativeCommand(request.connectionId, commandId, "serverRequest/respond", {
    requestId: request.requestId,
    result: request.result,
  });
}

/** Claims the exact pending row before handing its response to durable delivery. */
export async function respondToPendingServerRequest(request: {
  readonly database: PendingRequestDatabase;
  readonly pending: PendingServerRequest;
  readonly result: unknown;
}): Promise<void> {
  if (!request.database.claim(request.pending.connectionId, request.pending.requestKey)) {
    throw new Error("Request is no longer available for a response");
  }
  try {
    await deliverServerRequestResponse({
      connectionId: request.pending.connectionId,
      requestId: request.pending.requestId,
      responseKey:
        request.pending.method === "item/tool/requestUserInput"
          ? JSON.stringify([request.pending.requestKey, request.pending.createdAt])
          : request.pending.requestKey,
      result: request.result,
    });
  } catch (error) {
    request.database.release(request.pending.connectionId, request.pending.requestKey);
    throw error;
  }
}
