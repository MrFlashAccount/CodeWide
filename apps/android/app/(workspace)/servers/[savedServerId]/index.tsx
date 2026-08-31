import { useLocalSearchParams } from "expo-router";
import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";
import { ThreadListScreen } from "../../../../src/v2/features/threadList/ThreadListScreen";

export default function ServerRoute(): React.JSX.Element {
  return (
    <ThreadListScreen
      savedServerId={requireSavedServerRouteParam(useLocalSearchParams().savedServerId)}
    />
  );
}
