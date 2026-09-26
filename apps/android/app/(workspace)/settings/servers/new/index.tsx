import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";

import { recoverUnavailableRoute } from "../../../../../src/components/navigation/routeRecovery";
import { retryStartup } from "../../../../../src/data/workspace-runtime";
import { ConnectionSheet } from "../../../../../src/features/connections/ConnectionSheet";
import { useEvent } from "../../../../../src/react/useEvent";
import { pairingRouteSessions } from "../../../../../src/services/connections/pairingRouteSession";
import { routeSessionIdParam } from "../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../../../src/services/workspace/workspaceRouteResources";

/** Composes the existing validated pairing flow under route-owned Back history. */
export default function V1NewServerRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const closing = useRef(false);
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const parsedSessionId = routeSessionIdParam(sessionId);
  const routeSession =
    parsedSessionId.status === "valid"
      ? pairingRouteSessions.get(parsedSessionId.value.value)
      : null;
  const resources = useWorkspaceRouteResources();
  useRouteSessionLifetime(
    routeSession?.id ?? null,
    (id) => {
      pairingRouteSessions.close(id);
    },
    () => () => undefined,
  );
  const close = useEvent((): void => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    pairingRouteSessions.close(routeSession?.id);
    if (visible) {
      recoverUnavailableRoute(router, "/");
      return;
    }
    // A successful save may already have opened its destination above this route.
    router.dismissTo("/settings");
  });
  return (
    <ConnectionSheet
      initialCode={routeSession?.initialCode ?? null}
      localError={resources.runtime.error}
      localReady={resources.runtime.ready && resources.runtime.error === null}
      onClose={close}
      onRetryStartup={retryStartup}
      onSave={resources.connectionActions.saveConnection}
      visible={visible}
    />
  );
}
