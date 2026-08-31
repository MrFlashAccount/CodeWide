import { useLocalSearchParams } from "expo-router";

import { PortsScreen } from "../../../../../src/v2/features/ports/PortsScreen";
import { requireSavedServerRouteParam } from "../../../../../src/v2/features/navigation/routeParams";

export default function PortsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ savedServerId?: string | string[] }>();
  return <PortsScreen savedServerId={requireSavedServerRouteParam(params.savedServerId)} />;
}
