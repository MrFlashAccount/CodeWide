import { router, useLocalSearchParams } from "expo-router";

import { AgentThreadScreen } from "../../../../../../../src/v2/features/agents/AgentThreadScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../../src/v2/domain/qualifiedThread";
import { threadResourceDestination } from "../../../../../../../src/v2/features/navigation/routeDestinations";

export default function AgentThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    agentThreadId?: string | string[];
    savedServerId?: string | string[];
  }>();
  const owner = qualifiedThread(
    requireSavedServerRouteParam(params.savedServerId),
    requireThreadRouteParam(params.agentThreadId),
  );
  return (
    <AgentThreadScreen
      onOpenResource={(resourceName) => router.push(threadResourceDestination(owner, resourceName))}
      owner={owner}
    />
  );
}
