import type { ReactNode } from "react";
import { ApprovalPrompt } from "./RequestFeature";
import { useRequestResponse } from "./requestResponse";
import type { ConversationRequestCapabilities } from "./conversationRequestCapabilities";

type ConversationRequestPrompts = {
  readonly bottomRequestPrompt: ReactNode;
  readonly embeddedRequestPrompt: ReactNode;
};

/** Projects one pending server request into the embedded and bottom conversation surfaces. */
export function useConversationRequestPrompts(
  requests: ConversationRequestCapabilities,
): ConversationRequestPrompts {
  const response = useRequestResponse(requests.onRespondToRequest);
  const pendingRequest =
    requests.pendingRequest?.method === "item/tool/requestUserInput"
      ? null
      : requests.pendingRequest;
  const embeddedRequestPrompt =
    pendingRequest === null ? null : (
      <ApprovalPrompt
        embedded
        key={pendingRequest.requestKey}
        request={pendingRequest}
        requestCount={requests.pendingRequestCount}
        {...(requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: response.respondToRequest })}
      />
    );
  const bottomRequestPrompt =
    pendingRequest === null ? null : (
      <ApprovalPrompt
        key={pendingRequest.requestKey}
        request={pendingRequest}
        requestCount={requests.pendingRequestCount}
        {...(requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: requests.onRespondToRequest })}
      />
    );
  return { bottomRequestPrompt, embeddedRequestPrompt };
}
