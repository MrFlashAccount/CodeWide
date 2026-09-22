import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../src/components/navigation/RouteUnavailable";
import { ProjectThreadListRoute } from "../../../../src/routeComposition/ProjectThreadListRoute";
import { useEvent } from "../../../../src/react/useEvent";
import { projectListRouteSessions } from "../../../../src/services/projects/projectListRouteSession";
import { routeSessionIdParam } from "../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../src/services/useRouteSessionLifetime";

/** Presents one project catalog as an animated native-stack destination. */
export default function V1ProjectListRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const id = routeSessionIdParam(params.sessionId);
  const session = id.status === "valid" ? projectListRouteSessions.get(id.value.value) : null;
  const close = useEvent((): void => {
    router.dismissTo("/");
  });
  useRouteSessionLifetime(
    session?.id ?? null,
    (sessionId) => {
      projectListRouteSessions.close(sessionId);
    },
    (sessionId) => projectListRouteSessions.retain(sessionId),
  );
  if (session === null) {
    return (
      <RouteUnavailable
        message="Open the project again from Threads."
        onBack={close}
        title="Project unavailable"
      />
    );
  }
  return <ProjectThreadListRoute project={session.project} />;
}
