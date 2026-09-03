import { useState, useTransition } from "react";
import type { V2PendingRequest } from "@codewide/sync-client/v2";

import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import { threadId as parseThreadId, type SavedServerId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { useEvent } from "../../../react/useEvent";
import { PendingRequestView } from "../../presentation/requests/PendingRequestView";
import type { PendingRequestViewResolution } from "../../presentation/requests/requestViewModel";
import { pendingRequestResolution, pendingRequestViewModel } from "./pendingRequestAdapter";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface PendingRequestsPanelProps {
  embedded?: boolean;
  enabled?: boolean;
  openExternalLink?: ((url: string) => void | Promise<void>) | undefined;
  pendingRequests: readonly V2PendingRequest[];
  savedServerId: SavedServerId;
  threadId: string | null;
}

interface ActivePendingRequestProps {
  embedded: boolean;
  enabled: boolean;
  openExternalLink?: ((url: string) => void | Promise<void>) | undefined;
  pendingRequestCount: number;
  request: V2PendingRequest;
  savedServerId: SavedServerId;
  threadId: string;
}

interface ResolutionError {
  message: string;
  requestId: string;
}

/**
 * Renders the first request owned by one thread from the authoritative
 * projection. The next request appears only after authority publishes closure.
 */
export function PendingRequestsPanel(props: PendingRequestsPanelProps): React.JSX.Element | null {
  const {
    embedded = false,
    enabled = true,
    openExternalLink,
    pendingRequests,
    savedServerId,
    threadId,
  } = props;
  if (threadId === null) return null;
  const scopedRequests = pendingRequests.filter((request) => request.threadId === threadId);
  const request = scopedRequests[0];
  if (request === undefined) return null;
  return (
    <ActivePendingRequest
      embedded={embedded}
      enabled={enabled}
      openExternalLink={openExternalLink}
      pendingRequestCount={scopedRequests.length}
      request={request}
      savedServerId={savedServerId}
      threadId={threadId}
    />
  );
}

function ActivePendingRequest(props: ActivePendingRequestProps): React.JSX.Element {
  const {
    embedded,
    enabled,
    openExternalLink,
    pendingRequestCount,
    request,
    savedServerId,
    threadId,
  } = props;
  const runtime = useV2Runtime();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ResolutionError | null>(null);
  const model = pendingRequestViewModel(request);
  const position = pendingRequestCount > 1 ? `1/${pendingRequestCount}` : null;
  const owner = qualifiedThread(savedServerId, parseThreadId(threadId));
  const resolve = useEvent((resolution: PendingRequestViewResolution): void => {
    if (pending || !enabled) return;
    setError(null);
    startTransition(async () => {
      try {
        await runtime.requests.resolve(
          savedServerId,
          request,
          pendingRequestResolution(request, resolution),
        );
      } catch {
        setError({
          message: "Could not resolve request. Try again.",
          requestId: request.id,
        });
      }
    });
  });
  return (
    <PendingRequestView
      key={request.id}
      embedded={embedded}
      error={error?.requestId === request.id ? error.message : null}
      model={model}
      onOpenUrl={openExternalLink}
      onResolve={resolve}
      pending={pending || !enabled}
      position={position}
      // WHY: This is a render prop; repository callback policy delegates its identity to React Compiler instead of stabilizing it with useEvent/useCallback.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      renderElicitationInput={(field, inputProps) =>
        field.type !== "array" && field.type !== "text" ? undefined : (
          <VoiceTextInput
            {...inputProps}
            audience={savedServerId}
            scope={{ id: `request:${request.id}:field:${field.id}`, kind: "generic" }}
            thread={owner}
            value={typeof inputProps.value === "string" ? inputProps.value : ""}
          />
        )
      }
      // WHY: This is a render prop; repository callback policy delegates its identity to React Compiler instead of stabilizing it with useEvent/useCallback.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      renderUserInput={(question, inputProps) =>
        question.isSecret ? undefined : (
          <VoiceTextInput
            {...inputProps}
            audience={savedServerId}
            scope={{ id: `request:${request.id}:question:${question.id}`, kind: "generic" }}
            thread={owner}
            value={typeof inputProps.value === "string" ? inputProps.value : ""}
          />
        )
      }
    />
  );
}
