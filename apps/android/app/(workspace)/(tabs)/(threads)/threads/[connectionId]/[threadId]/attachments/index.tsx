import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../../../src/components/navigation/RouteUnavailable";
import { AttachmentsDestination } from "../../../../../../../../src/routeComposition/ConversationDestinations";
import { attachmentRouteSessions } from "../../../../../../../../src/services/attachments/attachmentRouteSession";
import { documentRouteService } from "../../../../../../../../src/services/documents/documentRouteService";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadRouteParams,
} from "../../../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../../../../../../src/services/workspace/workspaceRouteResources";

type ParsedThreadRoute = ReturnType<typeof v1ThreadRouteParams>;

function useAttachmentRouteSession(
  thread: ParsedThreadRoute,
  rawSessionId: string | readonly string[] | undefined,
) {
  const parsedSessionId = routeSessionIdParam(rawSessionId);
  const owner = thread.status === "valid" ? threadRouteSessionOwner(thread.value) : null;
  const session =
    owner !== null && parsedSessionId.status === "valid"
      ? attachmentRouteSessions.get(parsedSessionId.value.value, owner)
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      attachmentRouteSessions.close(id);
    },
    (id) => (owner === null ? () => undefined : attachmentRouteSessions.retain(id, owner)),
  );
  return session;
}

function closeAttachmentsRoute(
  session: ReturnType<typeof attachmentRouteSessions.get>,
  back: () => void,
): void {
  if (session !== null) {
    attachmentRouteSessions.close(session.id);
  }
  back();
}

function codeDocumentOpener(
  session: ReturnType<typeof attachmentRouteSessions.get>,
  fallback: Parameters<typeof AttachmentsDestination>[0]["onOpenDocument"],
): Parameters<typeof AttachmentsDestination>[0]["onOpenCodeDocument"] {
  return session === null ? fallback : session.request.openCodeDocument;
}

/** Composes attachments for one validated thread and opens documents by opaque session id. */
export default function V1AttachmentsRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const routeSession = useAttachmentRouteSession(params, raw.sessionId);
  const resources = useWorkspaceRouteResources();
  if (params.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={router.back}
        title="Attachments unavailable"
      />
    );
  }
  const connectionId = params.value.connectionId.value;
  const threadId = params.value.threadId.value;
  const openDocument = (request: Parameters<typeof documentRouteService.open>[1]): void => {
    const session = documentRouteService.open(threadRouteSessionOwner(params.value), request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/threads/[connectionId]/[threadId]/documents/[sessionId]",
    });
  };
  return (
    <AttachmentsDestination
      connectionId={connectionId}
      onClose={() => {
        closeAttachmentsRoute(routeSession, router.back);
      }}
      onOpenCodeDocument={codeDocumentOpener(routeSession, openDocument)}
      onOpenDocument={openDocument}
      resources={resources}
      threadId={threadId}
      visible={visible}
    />
  );
}
