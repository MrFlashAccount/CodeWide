import { useLocalSearchParams } from "expo-router";

import { threadIdParam } from "../../../../../../src/services/threads/threadRouteParams";
import { V1AgentsRouteContent } from "./index";

/** Preserves compatibility for a selected-agent route while the workspace owns selection. */
export default function V1AgentThreadRoute(): React.JSX.Element {
  const { agentThreadId } = useLocalSearchParams<{
    agentThreadId?: string | string[];
  }>();
  const parsed = threadIdParam(agentThreadId);
  return (
    <V1AgentsRouteContent initialThreadId={parsed.status === "valid" ? parsed.value.value : null} />
  );
}
