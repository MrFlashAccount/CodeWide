import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { CurrentChangesRoute } from "../../../../../../src/features/changes/RouteChangesWorkspace";
import { changesRouteSessions } from "../../../../../../src/services/changes/changesRouteSession";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../../src/services/useRouteSessionLifetime";

/** Presents the current-thread changes session captured at activation. */
export default function V1ChangesRoute(): React.JSX.Element {
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
      ? changesRouteSessions.get(parsed.value.value, threadRouteSessionOwner(thread.value))
      : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      changesRouteSessions.close(id);
    },
    (id) =>
      thread.status === "valid"
        ? changesRouteSessions.retain(id, threadRouteSessionOwner(thread.value))
        : () => undefined,
  );
  if (thread.status === "invalid" || session === null || session.request.kind !== "current") {
    return (
      <RouteUnavailable
        message="This changes session has expired."
        onBack={router.back}
        title="Changes unavailable"
      />
    );
  }
  const close = (): void => {
    changesRouteSessions.close(session.id);
    router.back();
  };
  return <CurrentChangesRoute onClose={close} request={session.request} />;
}
