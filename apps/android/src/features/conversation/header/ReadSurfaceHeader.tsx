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
> & {
  readonly identitySubtitle: string | null;
};

export function ReadSurfaceHeader(props: Props) {
  return (
    <ConversationHeader
      {...props}
      accountRateLimitsDatabase={null}
      archived={false}
      currentUsage={null}
      deleteThread={undefined}
      forkOffer={undefined}
      forkPicker={undefined}
      historyActivityModel={null}
      historyActivityResourceId={null}
      identitySubtitle={props.identitySubtitle}
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
