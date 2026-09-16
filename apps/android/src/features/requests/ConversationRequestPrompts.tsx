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
  const embeddedRequestPrompt =
    requests.pendingRequest === null ? null : (
      <ApprovalPrompt
        embedded
        key={requests.pendingRequest.requestKey}
        request={requests.pendingRequest}
        requestCount={requests.pendingRequestCount}
        {...(requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: response.respondToRequest })}
      />
    );
  const bottomRequestPrompt =
    requests.pendingRequest === null ? null : (
      <ApprovalPrompt
        key={requests.pendingRequest.requestKey}
        request={requests.pendingRequest}
        requestCount={requests.pendingRequestCount}
        {...(requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: requests.onRespondToRequest })}
      />
    );
  return { bottomRequestPrompt, embeddedRequestPrompt };
}
