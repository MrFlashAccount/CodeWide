import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../src/components/navigation/RouteUnavailable";
import { recoverUnavailableRoute } from "../../../src/components/navigation/routeRecovery";
import { DrawingWorkspace } from "../../../src/features/drawing/DrawingWorkspace";
import { drawingRouteSessions } from "../../../src/services/drawing/drawingRouteSession";
import {
  routeSessionIdParam,
  v1ThreadDestination,
} from "../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../src/services/useRouteSessionLifetime";

/** Presents a drawing against the admission captured by its bounded route session. */
export default function V1DrawingRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const parsed = routeSessionIdParam(sessionId);
  const session = parsed.status === "valid" ? drawingRouteSessions.get(parsed.value.value) : null;
  useRouteSessionLifetime(
    session?.id ?? null,
    (id) => {
      drawingRouteSessions.close(id);
    },
    (id) => drawingRouteSessions.retain(id),
  );
  if (session === null || session.status === "settled") {
    return (
      <RouteUnavailable
        message="This drawing session has expired or was already completed."
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onBack={() => {
          recoverUnavailableRoute(router, "/v1");
        }}
        title="Drawing unavailable"
      />
    );
  }
  const fallback =
    session.owner.kind === "thread"
      ? v1ThreadDestination(session.owner.thread)
      : session.owner.kind === "draft"
        ? "/v1/new"
        : "/v1";
  const close = (): void => {
    drawingRouteSessions.close(session.id);
    recoverUnavailableRoute(router, fallback);
  };
  return (
    <DrawingWorkspace
      editing={session.request.editing}
      initialSnapshot={session.request.initialSnapshot}
      mode={session.request.mode}
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onClose={close}
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onCommit={async (value) => drawingRouteSessions.commit(session.id, value)}
    />
  );
}
