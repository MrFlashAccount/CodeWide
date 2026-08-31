import { useLocalSearchParams } from "expo-router";

import { PortProfileScreen } from "../../../../../src/v2/features/ports/PortProfileScreen";
import {
  requireOpaqueRouteParam,
  requireSavedServerRouteParam,
} from "../../../../../src/v2/features/navigation/routeParams";

export default function PortRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    profileId?: string | string[];
    savedServerId?: string | string[];
  }>();
  return (
    <PortProfileScreen
      profileId={requireOpaqueRouteParam(params.profileId, "Port profile")}
      savedServerId={requireSavedServerRouteParam(params.savedServerId)}
    />
  );
}
