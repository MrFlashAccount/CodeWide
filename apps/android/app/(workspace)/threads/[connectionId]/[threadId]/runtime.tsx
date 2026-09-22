import { useIsFocused } from "expo-router";

import { ComposerRuntimeRoute } from "../../../../../src/features/composer/ComposerRuntimeRoutes";
import { RouteToolUnavailable } from "../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "../../../../../src/routeComposition/threadToolRouteSession";

/** Presents the route-owned runtime sheet for the qualified V1 thread. */
export default function V1RuntimeRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  const visible = useIsFocused();
  if (route.status === "unavailable" || route.session.request.kind !== "runtime") {
    return <RouteToolUnavailable onBack={route.recover} title="Runtime" />;
  }
  return (
    <ComposerRuntimeRoute
      onClose={route.recover}
      request={route.session.request}
      visible={visible}
    />
  );
}
