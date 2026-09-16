import { ComposerGoalRoute } from "../../../../../src/features/composer/ComposerActionRoutes";
import { RouteToolUnavailable } from "../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "./threadToolRouteSession";

/** Presents the route-owned goal sheet for the qualified V1 thread. */
export default function V1GoalRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  if (route.status === "unavailable" || route.session.request.kind !== "goal") {
    return <RouteToolUnavailable onBack={route.recover} title="Goal" />;
  }
  return <ComposerGoalRoute onClose={route.recover} request={route.session.request} />;
}
