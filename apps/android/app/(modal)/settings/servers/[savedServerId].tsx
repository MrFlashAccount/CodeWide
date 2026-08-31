import { router, useLocalSearchParams } from "expo-router";

import { useEvent } from "../../../../src/react/useEvent";
import { SavedServerSettingsScreen } from "../../../../src/v2/features/settings/SavedServerSettingsScreen";
import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function ServerSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ savedServerId?: string | string[] }>();
  const handleDeleted = useEvent(() => router.replace("/servers"));
  return (
    <SavedServerSettingsScreen
      onDeleted={handleDeleted}
      savedServerId={requireSavedServerRouteParam(params.savedServerId)}
    />
  );
}
