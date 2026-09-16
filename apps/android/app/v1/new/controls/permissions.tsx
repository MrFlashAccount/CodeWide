import { RouteToolUnavailable } from "../../../../src/components/navigation/RouteToolUnavailable";
import { ComposerControlRoute } from "../../../../src/features/composer/ComposerControlRoute";
import { useDraftToolRouteSession } from "../draftToolRouteSession";

/** Presents permission controls for the active V1 draft session. */
export default function V1DraftPermissionsRoute(): React.JSX.Element {
  const route = useDraftToolRouteSession();
  if (route.status === "unavailable" || route.session.request.kind !== "permissions") {
    return <RouteToolUnavailable onBack={route.recover} title="Permission controls" />;
  }
  return <ComposerControlRoute onClose={route.recover} request={route.session.request} />;
}
