import { useLocalSearchParams } from "expo-router";

import { V2NewSavedServer } from "../../../../src/v2/V2NewSavedServer";
import { pairingCodeRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function NewServerSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/settings/servers/new">();
  return <V2NewSavedServer initialCode={pairingCodeRouteParam(params.pairingCode)} />;
}
