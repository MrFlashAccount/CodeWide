import { useLocalSearchParams } from "expo-router";

import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";
import { NewThreadScreen } from "../../../../src/v2/features/threadList/NewThreadScreen";

export default function NewThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ savedServerId?: string | string[] }>();
  return <NewThreadScreen savedServerId={requireSavedServerRouteParam(params.savedServerId)} />;
}
