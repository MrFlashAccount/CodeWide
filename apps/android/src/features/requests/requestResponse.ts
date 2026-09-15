import type { PendingServerRequest } from "../../data/pending-request-types";
import { useEvent } from "../../react/useEvent";

export function useRequestResponse(
  onRespondToRequest:
    | ((request: PendingServerRequest, result: unknown) => Promise<void>)
    | undefined,
) {
  const respondToRequest = useEvent(async (request: PendingServerRequest, result: unknown) => {
    if (onRespondToRequest === undefined) throw new Error("Request response is unavailable");
    await onRespondToRequest(request, result);
  });
  return { respondToRequest };
}
