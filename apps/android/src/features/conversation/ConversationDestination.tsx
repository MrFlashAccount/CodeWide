import type { ConversationDestinationProps } from "./ConversationDetail";
import { MainConversationDetail, NewConversationDetail } from "./ConversationDetail";
/** Preserves separate suspending destination reads and the current navigation publication policy. */
export function ConversationDestination({ route, ...conversation }: ConversationDestinationProps) {
  return route.kind === "thread" ? (
    <MainConversationDetail {...conversation} {...route} />
  ) : (
    <NewConversationDetail {...conversation} {...route} />
  );
}
