import { useLocalSearchParams } from "expo-router";

import { AgentsScreen } from "../../../../../../../src/v2/features/agents/AgentsScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../../src/v2/domain/qualifiedThread";

export default function AgentsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    savedServerId?: string | string[];
    threadId?: string | string[];
  }>();
  return (
    <AgentsScreen
      owner={qualifiedThread(
        requireSavedServerRouteParam(params.savedServerId),
        requireThreadRouteParam(params.threadId),
      )}
    />
  );
}
