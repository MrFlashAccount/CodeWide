import { Redirect, useLocalSearchParams } from "expo-router";
import { savedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";
import { ThreadListScreen } from "../../../../src/v2/features/threadList/ThreadListScreen";

export default function ServerRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (savedServerId === null) return <Redirect href="/servers" />;
  return <ThreadListScreen savedServerId={savedServerId} />;
}
