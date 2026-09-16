import { RouteToolUnavailable } from "../../../../src/components/navigation/RouteToolUnavailable";
import { ComposerControlRoute } from "../../../../src/features/composer/ComposerControlRoute";
import { useDraftToolRouteSession } from "../draftToolRouteSession";

/** Presents skill controls for the active V1 draft session. */
export default function V1DraftSkillsRoute(): React.JSX.Element {
  const route = useDraftToolRouteSession();
  if (route.status === "unavailable" || route.session.request.kind !== "skills") {
    return <RouteToolUnavailable onBack={route.recover} title="Skills" />;
  }
  return <ComposerControlRoute onClose={route.recover} request={route.session.request} />;
}
