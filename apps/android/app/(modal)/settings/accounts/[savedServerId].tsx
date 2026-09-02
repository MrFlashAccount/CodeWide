import { Redirect, useLocalSearchParams } from "expo-router";

import { AccountSettingsScreen } from "../../../../src/v2/features/settings/AccountSettingsScreen";
import { savedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function AccountSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/settings/accounts/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (savedServerId === null) return <Redirect href="/settings" />;
  return <AccountSettingsScreen savedServerId={savedServerId} />;
}
