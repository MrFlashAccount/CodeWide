import { useIsFocused } from "expo-router";

import { ComposerQueueRoute } from "../../../../../src/features/composer/ComposerActionRoutes";
import { RouteToolUnavailable } from "../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "../../../../../src/routeComposition/threadToolRouteSession";

/** Presents the route-owned queued prompt sheet for the qualified V1 thread. */
export default function V1QueueRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  const visible = useIsFocused();
  if (route.status === "unavailable" || route.session.request.kind !== "queue") {
    return <RouteToolUnavailable onBack={route.recover} title="Queue" />;
  }
  return (
    <ComposerQueueRoute onClose={route.recover} request={route.session.request} visible={visible} />
  );
}
