import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { useEvent } from "../../../../../../src/react/useEvent";
import { AddProjectSheet } from "../../../../../../src/routeComposition/ProjectManagementSheets";
import { connectionIdParam } from "../../../../../../src/services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../../../../../../src/services/workspace/workspaceRouteResources";

/** Starts folder browsing on the route server while permitting an explicit local server change. */
export default function V1AddProjectRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const { connectionId } = useLocalSearchParams<{ connectionId?: string | string[] }>();
  const parsed = connectionIdParam(connectionId);
  const resources = useWorkspaceRouteResources();
  const close = useEvent(() => {
    router.dismissTo("/projects");
  });
  if (
    parsed.status === "invalid" ||
    !resources.connections.some((connection) => connection.id === parsed.value.value)
  ) {
    return (
      <RouteUnavailable
        message="Choose an available server to add a project."
        onBack={() => {
          router.dismissTo("/projects");
        }}
        title="Server unavailable"
      />
    );
  }
  return (
    <AddProjectSheet initialConnectionId={parsed.value.value} onClose={close} visible={visible} />
  );
}
