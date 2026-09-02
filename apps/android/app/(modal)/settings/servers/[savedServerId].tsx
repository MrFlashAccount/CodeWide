import { Redirect, router, useLocalSearchParams } from "expo-router";

import { useEvent } from "../../../../src/react/useEvent";
import { SavedServerSettingsScreen } from "../../../../src/v2/features/settings/SavedServerSettingsScreen";
import { savedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function ServerSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/settings/servers/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  const handleDeleted = useEvent(() => router.replace("/servers"));
  if (savedServerId === null) return <Redirect href="/settings" />;
  return <SavedServerSettingsScreen onDeleted={handleDeleted} savedServerId={savedServerId} />;
}
