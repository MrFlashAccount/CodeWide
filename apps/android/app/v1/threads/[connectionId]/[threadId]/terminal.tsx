import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../src/components/navigation/routeRecovery";
import { ConversationRouteFullscreenOverlay } from "../../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import {
  v1ThreadRouteParams,
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
} from "../../../../../src/services/threads/threadRouteParams";
import { terminalRouteSessions } from "../../../../../src/services/terminal/terminalRouteSession";
import { useRouteSessionLifetime } from "../../../../../src/services/useRouteSessionLifetime";

/** Presents the retained native Terminal workspace without disposing tabs on route Back. */
export default function V1TerminalRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const sessionId = routeSessionIdParam(raw.sessionId);
  const session =
    sessionId.status === "valid" && params.status === "valid"
      ? terminalRouteSessions.get(sessionId.value.value, threadRouteSessionOwner(params.value))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      terminalRouteSessions.close(id);
    },
    (id) =>
      params.status === "valid"
        ? terminalRouteSessions.retain(id, threadRouteSessionOwner(params.value))
        : () => undefined,
  );
  if (params.status === "invalid" || session === null) {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={() => {
          recoverUnavailableRoute(
            router,
            params.status === "valid" ? v1ThreadDestination(params.value) : "/v1",
          );
        }}
        title="Terminal unavailable"
      />
    );
  }
  const close = (): void => {
    terminalRouteSessions.close(session.id);
    recoverUnavailableRoute(router, v1ThreadDestination(params.value));
  };
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => (
        <TerminalWorkspace
          connectionId={session.request.connectionId}
          cwd={session.request.cwd}
          onMinimize={closeOverlay}
          threadId={session.request.threadId}
        />
      )}
      scope={`terminal:${session.id}`}
    />
  );
}
