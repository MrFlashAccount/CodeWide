import { router, useLocalSearchParams } from "expo-router";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";
import { ConversationScreen } from "../../../../../../src/v2/features/conversation/ConversationScreen";
import { threadResourceDestination } from "../../../../../../src/v2/features/navigation/routeDestinations";

export default function ThreadRoute(): React.JSX.Element {
  const params = useLocalSearchParams();
  const owner = qualifiedThread(
    requireSavedServerRouteParam(params.savedServerId),
    requireThreadRouteParam(params.threadId),
  );
  return (
    <ConversationScreen
      onOpenResource={(resourceName) => router.push(threadResourceDestination(owner, resourceName))}
      owner={owner}
    />
  );
}
