import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { recoverUnavailableRoute } from "../../../../../src/components/navigation/routeRecovery";
import { ProjectManagementSheet } from "../../../../../src/routeComposition/ProjectManagementSheets";

/**
 * Composes project management while each directory browser has its own route. The transparent
 * route keeps the covered destination mounted and visible; the native sheet window presents the
 * surface over the whole application while this route is focused.
 */
export default function V1ProjectsRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  return (
    <ProjectManagementSheet
      initialConnectionId={connectionId ?? null}
      onBrowse={(connectionId) => {
        if (connectionId === null) {
          router.push("/projects/add");
        } else {
          router.push({ params: { connectionId }, pathname: "/projects/add/[connectionId]" });
        }
      }}
      onClose={() => {
        recoverUnavailableRoute(router, "/");
      }}
      visible={visible}
    />
  );
}
