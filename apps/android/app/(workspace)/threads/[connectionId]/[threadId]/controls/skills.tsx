import { ComposerControlRoute } from "../../../../../../src/features/composer/ComposerControlRoute";
import { useIsFocused } from "expo-router";

import { RouteToolUnavailable } from "../../../../../../src/components/navigation/RouteToolUnavailable";
import { useThreadToolRouteSession } from "../../../../../../src/routeComposition/threadToolRouteSession";

/** Presents skill controls for the Router-qualified V1 thread. */
export default function V1SkillsRoute(): React.JSX.Element {
  const route = useThreadToolRouteSession();
  const visible = useIsFocused();
  if (route.status === "unavailable" || route.session.request.kind !== "skills") {
    return <RouteToolUnavailable onBack={route.recover} title="Skills" />;
  }
  return (
    <ComposerControlRoute
      onClose={route.recover}
      request={route.session.request}
      visible={visible}
    />
  );
}
