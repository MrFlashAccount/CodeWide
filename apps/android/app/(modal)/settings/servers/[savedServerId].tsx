import { router, useLocalSearchParams } from "expo-router";

import { SavedServerSettingsScreen } from "../../../../src/v2/features/settings/SavedServerSettingsScreen";
import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function ServerSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ savedServerId?: string | string[] }>();
  return (
    <SavedServerSettingsScreen
      onDeleted={() => router.replace("/servers")}
      savedServerId={requireSavedServerRouteParam(params.savedServerId)}
    />
  );
}
