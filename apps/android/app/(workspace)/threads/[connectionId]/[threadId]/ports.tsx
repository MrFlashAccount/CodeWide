import { useIsFocused } from "expo-router";

import { ComposerPortsRoute } from "../../../../../src/features/composer/ComposerRuntimeRoutes";
import { RouteToolUnavailable } from "../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "../../../../../src/routeComposition/threadToolRouteSession";

/** Presents the route-owned port forwarding sheet for the qualified V1 thread. */
export default function V1PortsRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  const visible = useIsFocused();
  if (route.status === "unavailable" || route.session.request.kind !== "ports") {
    return <RouteToolUnavailable onBack={route.recover} title="Ports" />;
  }
  return (
    <ComposerPortsRoute onClose={route.recover} request={route.session.request} visible={visible} />
  );
}
