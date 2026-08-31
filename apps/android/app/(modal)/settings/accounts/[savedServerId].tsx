import { useLocalSearchParams } from "expo-router";

import { AccountSettingsScreen } from "../../../../src/v2/features/settings/AccountSettingsScreen";
import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export default function AccountSettingsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ savedServerId?: string | string[] }>();
  return (
    <AccountSettingsScreen savedServerId={requireSavedServerRouteParam(params.savedServerId)} />
  );
}
