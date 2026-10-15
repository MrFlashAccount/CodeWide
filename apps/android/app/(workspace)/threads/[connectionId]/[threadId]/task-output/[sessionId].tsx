import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../../src/components/navigation/routeRecovery";
import { ConversationRouteFullscreenOverlay } from "../../../../../../src/features/conversation/ConversationRouteFullscreenOverlay";
import { BackgroundTaskOutputScreen } from "../../../../../../src/features/conversation/turns/BackgroundTaskOutputScreen";
import { taskOutputRouteSessions } from "../../../../../../src/services/backgroundTasks/taskOutputRouteSession";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
  v1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../src/services/useRouteSessionLifetime";

/** Restores one background task's output screen without putting its reader in the URL. */
export default function V1TaskOutputRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsed = routeSessionIdParam(raw.sessionId);
  const thread = v1ThreadRouteParams(raw);
  const session =
    parsed.status === "valid" && thread.status === "valid"
      ? taskOutputRouteSessions.get(parsed.value.value, threadRouteSessionOwner(thread.value))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      taskOutputRouteSessions.close(id);
    },
    (id) =>
      thread.status === "valid"
        ? taskOutputRouteSessions.retain(id, threadRouteSessionOwner(thread.value))
        : () => undefined,
  );
  if (session === null || thread.status === "invalid") {
    return (
      <RouteUnavailable
        message="This task output session has expired."
        onBack={() => {
          recoverUnavailableRoute(
            router,
            thread.status === "valid" ? v1ThreadDestination(thread.value) : "/",
          );
        }}
        title="Task output unavailable"
      />
    );
  }
  const close = (): void => {
    taskOutputRouteSessions.close(session.id);
    router.back();
  };
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => (
        <BackgroundTaskOutputScreen
          onClose={closeOverlay}
          opening={session.id}
          request={session.request}
        />
      )}
      scope={`task-output:${session.id}`}
    />
  );
}
