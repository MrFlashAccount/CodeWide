import type { ReactNode } from "react";
import { ApprovalPrompt } from "./RequestFeature";
import { useRequestResponse } from "./requestResponse";
import type { ConversationRequestCapabilities } from "./conversationRequestCapabilities";

/**
 * The prompt shown inside the in-progress turn row, with the revision of the
 * request it shows. Virtualized rows re-render only when their data or the
 * list's `extraData` change, so the timeline publishes `revision` to the list.
 */
export type EmbeddedRequestPrompt = {
  readonly node: ReactNode;
  readonly revision: string;
};

type ConversationRequestPrompts = {
  readonly bottomRequestPrompt: ReactNode;
  readonly embeddedRequestPrompt: EmbeddedRequestPrompt | null;
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
    pendingRequest === null
      ? null
      : {
          node: (
            <ApprovalPrompt
              embedded
              key={pendingRequest.requestKey}
              request={pendingRequest}
              requestCount={requests.pendingRequestCount}
              {...(requests.onRespondToRequest === undefined
                ? {}
                : { onRespond: response.respondToRequest })}
            />
          ),
          revision: `${pendingRequest.requestKey}:${pendingRequest.state}:${String(requests.pendingRequestCount)}`,
        };
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
