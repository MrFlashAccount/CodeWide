import { Redirect, useLocalSearchParams } from "expo-router";

import { V2AccountSettings } from "../../../../src/v2/V2AccountSettings";
import { savedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function AccountSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/settings/accounts/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (savedServerId === null) return <Redirect href="/settings" />;
  return <V2AccountSettings savedServerId={savedServerId} />;
}
