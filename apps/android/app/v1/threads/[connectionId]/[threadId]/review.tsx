import { ComposerReviewRoute } from "../../../../../src/features/composer/ComposerActionRoutes";
import { RouteToolUnavailable } from "../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "./threadToolRouteSession";

/** Presents the route-owned review action for the qualified V1 thread. */
export default function V1ReviewRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  if (route.status === "unavailable" || route.session.request.kind !== "review") {
    return <RouteToolUnavailable onBack={route.recover} title="Review" />;
  }
  return <ComposerReviewRoute onClose={route.recover} request={route.session.request} />;
}
