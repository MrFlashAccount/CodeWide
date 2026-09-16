import { useLocalSearchParams, useRouter } from "expo-router";

import { retryStartup } from "../../../../../src/data/workspace-runtime";
import { ConnectionSheet } from "../../../../../src/features/connections/ConnectionSheet";
import { pairingRouteSessions } from "../../../../../src/services/connections/pairingRouteSession";
import { routeSessionIdParam } from "../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../../../src/services/workspace/workspaceRouteResources";

/** Composes the existing validated pairing flow under route-owned Back history. */
export default function V1NewServerRoute(): React.JSX.Element {
  const router = useRouter();
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
  const close = (): void => {
    pairingRouteSessions.close(routeSession?.id);
    router.dismissTo("/v1/settings");
  };
  return (
    <ConnectionSheet
      initialCode={routeSession?.initialCode ?? null}
      localError={resources.runtime.error}
      localReady={resources.runtime.ready && resources.runtime.error === null}
      onClose={close}
      onRetryStartup={retryStartup}
      onSave={resources.connectionActions.saveConnection}
      visible
    />
  );
}
