import { router, useLocalSearchParams } from "expo-router";
import { useEvent } from "../../../../../../src/react/useEvent";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";
import { ConversationScreen } from "../../../../../../src/v2/features/conversation/ConversationScreen";
import {
  portsDestination,
  threadResourceDestination,
} from "../../../../../../src/v2/features/navigation/routeDestinations";

export default function ThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams();
  const owner = qualifiedThread(
    requireSavedServerRouteParam(params.savedServerId),
    requireThreadRouteParam(params.threadId),
  );
  const openResource = useEvent((resourceName: Parameters<typeof threadResourceDestination>[1]) =>
    router.push(threadResourceDestination(owner, resourceName)),
  );
  const openPorts = useEvent(() => router.push(portsDestination(owner.savedServerId)));
  const goBack = useEvent(() => router.back());
  return (
    <ConversationScreen
      onBack={goBack}
      onOpenPorts={openPorts}
      onOpenResource={openResource}
      owner={owner}
    />
  );
}
