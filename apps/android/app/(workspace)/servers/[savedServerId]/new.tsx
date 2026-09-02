import { Redirect, useLocalSearchParams } from "expo-router";

import { savedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";
import { NewThreadScreen } from "../../../../src/v2/features/threadList/NewThreadScreen";

export default function NewThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/new">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (savedServerId === null) return <Redirect href="/servers" />;
  return <NewThreadScreen savedServerId={savedServerId} />;
}
