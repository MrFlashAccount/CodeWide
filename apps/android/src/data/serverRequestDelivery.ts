import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

import { enqueueNativeCommand } from "../native/native-transport";
import { globalSupervisorRequestCommandId } from "./globalSupervisorRequestIdentity";

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
