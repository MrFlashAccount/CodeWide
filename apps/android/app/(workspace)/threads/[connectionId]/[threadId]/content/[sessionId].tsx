import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../../src/components/navigation/routeRecovery";
import { ConversationRouteFullscreenOverlay } from "../../../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { LargeContentViewerSession } from "../../../../../../src/features/conversation/content/FullContentViewer";
import { ActivityContentViewer } from "../../../../../../src/features/conversation/content/ActivityContentViewer";
import { CommandContentViewer } from "../../../../../../src/features/conversation/content/CommandContentViewer";
import { contentRouteSessions } from "../../../../../../src/services/content/contentRouteSession";
import { useWorkspaceRouteResources } from "../../../../../../src/services/workspace/workspaceRouteResources";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
  v1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../src/services/useRouteSessionLifetime";

/** Restores one bounded large-content request without exposing its transfer capability in the URL. */
export default function V1ContentRoute(): React.JSX.Element {
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsed = routeSessionIdParam(raw.sessionId);
  const thread = v1ThreadRouteParams(raw);
  const session =
    parsed.status === "valid" && thread.status === "valid"
      ? contentRouteSessions.get(parsed.value.value, threadRouteSessionOwner(thread.value))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      contentRouteSessions.close(id);
    },
    (id) =>
      thread.status === "valid"
        ? contentRouteSessions.retain(id, threadRouteSessionOwner(thread.value))
        : () => undefined,
  );
  if (session === null || thread.status === "invalid") {
    return (
      <RouteUnavailable
        message="This content session has expired."
        onBack={() => {
          recoverUnavailableRoute(
            router,
            thread.status === "valid" ? v1ThreadDestination(thread.value) : "/",
          );
        }}
        title="Content unavailable"
      />
    );
  }
  const close = (): void => {
    contentRouteSessions.close(session.id);
    router.back();
  };
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => {
        if (session.request.kind === "reference") {
          return (
            <LargeContentViewerSession initialRequest={session.request} onClose={closeOverlay} />
          );
        }
        if (session.request.kind === "command") {
          return (
            <CommandContentViewer
              connectionId={thread.value.connectionId.value}
              database={resources.runtime.threadDetails}
              onClose={closeOverlay}
              request={session.request}
              threadId={session.request.threadId}
            />
          );
        }
        return (
          <ActivityContentViewer
            onClose={closeOverlay}
            presentation={session.request.presentation}
            text={session.request.text}
            title={session.request.title}
          />
        );
      }}
      scope={`content:${session.id}`}
    />
  );
}
