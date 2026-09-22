import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { RouteDocumentPreview } from "../../../../../../src/features/attachments/RouteDocumentPreview";
import { RouteCodeDocumentReview } from "../../../../../../src/features/changes/RouteCodeDocumentReview";
import { ConversationRouteFullscreenOverlay } from "../../../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { changesRouteSessions } from "../../../../../../src/services/changes/changesRouteSession";
import { documentRouteService } from "../../../../../../src/services/documents/documentRouteService";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../src/services/useRouteSessionLifetime";

type ThreadDocumentSessions =
  | { readonly status: "invalid" }
  | {
      readonly code: ReturnType<typeof changesRouteSessions.get>;
      readonly document: ReturnType<typeof documentRouteService.get>;
      readonly status: "valid";
      readonly thread: Extract<
        ReturnType<typeof v1ThreadRouteParams>,
        { readonly status: "valid" }
      >["value"];
    };

function resolveThreadDocumentSessions(raw: {
  readonly connectionId?: string | readonly string[];
  readonly sessionId?: string | readonly string[];
  readonly threadId?: string | readonly string[];
}): ThreadDocumentSessions {
  const thread = v1ThreadRouteParams(raw);
  const id = routeSessionIdParam(raw.sessionId);
  if (thread.status === "invalid" || id.status === "invalid") {
    return { status: "invalid" };
  }
  const owner = threadRouteSessionOwner(thread.value);
  return {
    code: changesRouteSessions.get(id.value.value, owner),
    document: documentRouteService.get(id.value.value, owner),
    status: "valid",
    thread: thread.value,
  };
}

function retainedSessionId(session: { readonly id: string } | null): string | null {
  return session === null ? null : session.id;
}

/** Presents one private document session and pushes nested documents one route at a time. */
export default function V1DocumentRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const sessions = resolveThreadDocumentSessions(raw);
  const codeSession = sessions.status === "valid" ? sessions.code : null;
  const documentSession = sessions.status === "valid" ? sessions.document : null;
  useRouteSessionLifetime(
    retainedSessionId(codeSession),
    (sessionId) => {
      changesRouteSessions.close(sessionId);
    },
    (sessionId) =>
      sessions.status === "valid"
        ? changesRouteSessions.retain(sessionId, threadRouteSessionOwner(sessions.thread))
        : () => undefined,
  );
  useRouteSessionLifetime(
    retainedSessionId(documentSession),
    (sessionId) => {
      documentRouteService.close(sessionId);
    },
    (sessionId) =>
      sessions.status === "valid"
        ? documentRouteService.retain(sessionId, threadRouteSessionOwner(sessions.thread))
        : () => undefined,
  );
  if (sessions.status === "valid" && codeSession?.request.kind === "codeDocument") {
    const request = codeSession.request;
    const closeCodeDocument = (): void => {
      changesRouteSessions.close(codeSession.id);
      router.back();
    };
    return (
      <ConversationRouteFullscreenOverlay
        onDismiss={closeCodeDocument}
        render={(closeOverlay) => (
          <RouteCodeDocumentReview onClose={closeOverlay} request={request} />
        )}
        scope={`code-document:${codeSession.id}`}
      />
    );
  }
  if (sessions.status === "invalid" || documentSession === null) {
    return (
      <RouteUnavailable
        message="This document session has expired."
        onBack={router.back}
        title="Document unavailable"
      />
    );
  }
  const close = (): void => {
    documentRouteService.close(documentSession.id);
    router.back();
  };
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => (
        <RouteDocumentPreview
          onClose={closeOverlay}
          onOpenDocument={(request) => {
            const nested = documentRouteService.open(documentSession.owner, request);
            router.push({
              params: {
                connectionId: sessions.thread.connectionId.value,
                sessionId: nested.id,
                threadId: sessions.thread.threadId.value,
              },
              pathname: "/threads/[connectionId]/[threadId]/documents/[sessionId]",
            });
          }}
          request={documentSession.request}
        />
      )}
      scope={`document:${documentSession.id}`}
    />
  );
}
