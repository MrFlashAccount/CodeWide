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
      accountRateLimitsDatabase={null}
      archived={false}
      currentUsage={null}
      deleteThread={undefined}
      historyActivityModel={null}
      historyActivityResourceId={null}
      newChat={false}
      onArchive={undefined}
      onCompact={undefined}
      onFork={undefined}
      onRefreshAccountRateLimits={undefined}
      onTogglePin={undefined}
      onUnarchive={undefined}
      openThreadRename={() => undefined}
      pinned={false}
      readOnly
      threadChatModel={null}
    />
  );
}
