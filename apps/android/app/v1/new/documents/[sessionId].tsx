import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../src/components/navigation/RouteUnavailable";
import { RouteDocumentPreview } from "../../../../src/features/attachments/RouteDocumentPreview";
import { RouteCodeDocumentReview } from "../../../../src/features/changes/RouteCodeDocumentReview";
import { ConversationRouteFullscreenOverlay } from "../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { changesRouteSessions } from "../../../../src/services/changes/changesRouteSession";
import { documentRouteService } from "../../../../src/services/documents/documentRouteService";
import { newThreadService } from "../../../../src/services/threads/newThreadService";
import {
  draftRouteSessionOwner,
  routeSessionIdParam,
} from "../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../src/services/useRouteSessionLifetime";

type DraftDocumentSessions = {
  readonly code: ReturnType<typeof changesRouteSessions.get>;
  readonly document: ReturnType<typeof documentRouteService.get>;
  readonly owner: ReturnType<typeof draftRouteSessionOwner> | null;
};

function resolveDraftDocumentSessions(
  sessionId: string | readonly string[] | undefined,
): DraftDocumentSessions {
  const parsed = routeSessionIdParam(sessionId);
  const draft = newThreadService.current();
  if (parsed.status === "invalid" || draft === null) {
    return { code: null, document: null, owner: null };
  }
  const owner = draftRouteSessionOwner(draft.id);
  return {
    code: changesRouteSessions.get(parsed.value.value, owner),
    document: documentRouteService.get(parsed.value.value, owner),
    owner,
  };
}

function retainedSessionId(session: { readonly id: string } | null): string | null {
  return session === null ? null : session.id;
}

/** Presents one private document session opened from the retained draft. */
export default function V1DraftDocumentRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessions = resolveDraftDocumentSessions(sessionId);
  const codeSession = sessions.code;
  const documentSession = sessions.document;
  useRouteSessionLifetime(
    retainedSessionId(codeSession),
    (id) => {
      changesRouteSessions.close(id);
    },
    (id) =>
      sessions.owner === null ? () => undefined : changesRouteSessions.retain(id, sessions.owner),
  );
  useRouteSessionLifetime(
    retainedSessionId(documentSession),
    (id) => {
      documentRouteService.close(id);
    },
    (id) =>
      sessions.owner === null ? () => undefined : documentRouteService.retain(id, sessions.owner),
  );
  if (codeSession?.request.kind === "codeDocument") {
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
        scope={`draft-code-document:${codeSession.id}`}
      />
    );
  }
  if (documentSession === null) {
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
              params: { sessionId: nested.id },
              pathname: "/v1/new/documents/[sessionId]",
            });
          }}
          request={documentSession.request}
        />
      )}
      scope={`draft-document:${documentSession.id}`}
    />
  );
}
