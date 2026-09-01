import { router, useLocalSearchParams } from "expo-router";

import { useEvent } from "../../../../../../../src/react/useEvent";
import { AgentThreadScreen } from "../../../../../../../src/v2/features/agents/AgentThreadScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../../src/v2/domain/qualifiedThread";
import {
  portsDestination,
  threadResourceDestination,
} from "../../../../../../../src/v2/features/navigation/routeDestinations";

export default function AgentThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    agentThreadId?: string | string[];
    savedServerId?: string | string[];
  }>();
  const owner = qualifiedThread(
    requireSavedServerRouteParam(params.savedServerId),
    requireThreadRouteParam(params.agentThreadId),
  );
  const openResource = useEvent((resourceName: Parameters<typeof threadResourceDestination>[1]) =>
    router.push(threadResourceDestination(owner, resourceName)),
  );
  const openPorts = useEvent(() => router.push(portsDestination(owner.savedServerId)));
  const goBack = useEvent(() => router.back());
  return (
    <AgentThreadScreen
      onBack={goBack}
      onOpenPorts={openPorts}
      onOpenResource={openResource}
      owner={owner}
    />
  );
}
