import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEvent } from "../../../../../../src/react/useEvent";
import { qualifiedThreadRouteParams } from "../../../../../../src/v2/features/navigation/routeParams";
import { ConversationScreen } from "../../../../../../src/v2/features/conversation/ConversationScreen";
import {
  portsDestination,
  threadResourceDestination,
} from "../../../../../../src/v2/features/navigation/routeDestinations";

export default function ThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]">();
  const owner = qualifiedThreadRouteParams(params);
  const openResource = useEvent((resourceName: Parameters<typeof threadResourceDestination>[1]) =>
    owner === null ? undefined : router.push(threadResourceDestination(owner, resourceName)),
  );
  const openPorts = useEvent(() =>
    owner === null ? undefined : router.push(portsDestination(owner.savedServerId)),
  );
  const goBack = useEvent(() => router.back());
  if (owner === null) return <Redirect href="/servers" />;
  return (
    <ConversationScreen
      onBack={goBack}
      onOpenPorts={openPorts}
      onOpenResource={openResource}
      owner={owner}
    />
  );
}
