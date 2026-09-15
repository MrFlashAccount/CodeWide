import { ConversationHeader } from "./ConversationHeader";
import type { ConversationHeaderProps } from "./ConversationHeaderContract";

type Props = Pick<
  ConversationHeaderProps,
  | "compact"
  | "onBack"
  | "thread"
  | "server"
  | "cwd"
  | "remoteThread"
  | "draftConnectionId"
  | "draftThreadId"
  | "threadSearchVisible"
  | "closeThreadSearch"
  | "setThreadSearchVisible"
  | "sessionCompactionCount"
  | "dismissComposerKeyboardForOverlay"
>;

export function ReadSurfaceHeader(props: Props) {
  return (
    <ConversationHeader
      {...props}
      threadChatModel={null}
      historyActivityModel={null}
      historyActivityResourceId={null}
      newChat={false}
      currentUsage={null}
      accountRateLimitsDatabase={null}
      onRefreshAccountRateLimits={undefined}
      readOnly
      archived={false}
      pinned={false}
      openThreadRename={() => undefined}
      onTogglePin={undefined}
      onUnarchive={undefined}
      onArchive={undefined}
      onCompact={undefined}
      onFork={undefined}
      deleteThread={undefined}
    />
  );
}
