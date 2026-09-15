import { ALL_SERVERS_ID } from "./serverSelection";
import type { ConversationDestination as ConversationNavigationDestination } from "./threadNavigation";
import { parseThreadSelectionKey } from "./threadSelection";

export function workspaceConversationScope(
  destination: ConversationNavigationDestination,
  fallbackServerId: string,
) {
  const draft = destination.kind === "draft" ? destination.draft : null;
  const target = destination.kind === "thread" ? parseThreadSelectionKey(destination.key) : null;
  return {
    connectionId:
      draft?.serverId ??
      target?.connectionId ??
      (fallbackServerId === ALL_SERVERS_ID ? "" : fallbackServerId),
    threadId: target?.threadId ?? null,
    composerThreadId: draft?.id ?? target?.threadId ?? null,
  };
}
