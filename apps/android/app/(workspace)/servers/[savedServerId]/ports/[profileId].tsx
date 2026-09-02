import { Redirect, useLocalSearchParams } from "expo-router";

import { PortProfileScreen } from "../../../../../src/v2/features/ports/PortProfileScreen";
import {
  opaqueRouteParam,
  savedServerRouteParam,
} from "../../../../../src/v2/features/navigation/routeParams";

export default function PortRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/ports/[profileId]">();
  const profileId = opaqueRouteParam(params.profileId);
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (profileId === null || savedServerId === null) return <Redirect href="/servers" />;
  return <PortProfileScreen profileId={profileId} savedServerId={savedServerId} />;
}
