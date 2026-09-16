import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../../../../src/components/navigation/routeRecovery";
import { LargeContentViewerSession } from "../../../../../../src/features/conversation/content/FullContentViewer";
import { contentRouteSessions } from "../../../../../../src/services/content/contentRouteSession";
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
            thread.status === "valid" ? v1ThreadDestination(thread.value) : "/v1",
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
  return <LargeContentViewerSession initialRequest={session.request} onClose={close} />;
}
