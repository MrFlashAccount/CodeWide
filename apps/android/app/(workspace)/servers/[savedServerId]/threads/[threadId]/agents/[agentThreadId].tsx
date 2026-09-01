import { useLocalSearchParams } from "expo-router";
import { AgentThreadScreen } from "../../../../../../../src/v2/features/agents/AgentThreadScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../../src/v2/domain/qualifiedThread";

export default function AgentThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    agentThreadId?: string | string[];
    savedServerId?: string | string[];
    threadId?: string | string[];
  }>();
  const owner = qualifiedThread(
    requireSavedServerRouteParam(params.savedServerId),
    requireThreadRouteParam(params.threadId),
  );
  return (
    <AgentThreadScreen
      owner={owner}
      selectedAgentThreadId={requireThreadRouteParam(params.agentThreadId)}
    />
  );
}
