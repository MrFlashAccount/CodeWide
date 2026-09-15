import type { ReactNode } from "react";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationAccountCapabilities } from "../accounts/conversationAccountCapabilities";
import { useTerminalDeletion } from "../terminal/terminalActions";
import { useThreadRename } from "../turnActions/threadRename";
import { ConversationBottomChrome } from "./ConversationBottomChrome";
import { createConversationComposerContent } from "./ConversationComposerContent";
import { ConversationHeader } from "./header/ConversationHeader";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useConversationTimelineState } from "./timeline/conversationTimelineState";
import { JumpToLatest } from "./timeline/JumpToLatest";
import { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import { TimelineSearchBar } from "./timeline/TimelineSearchBar";
export function createConversationChromeContent({
  thread,
  compact,
  surfaceInputs,
  threadChatModel,
  draftConnectionId,
  draftThreadId,
  historyActivityModel,
  historyActivityResourceId,
  cwd,
  newChat,
  timelineState,
  timelineRead,
  readInputs,
  currentUsage,
  accountRateLimitsDatabase,
  accountsInputs,
  readOnly,
  archived,
  pinned,
  overlayScrollOwnershipBinding,
  threadRenameBinding,
  actionsInputs,
  deleteThread,
  requestPrompt,
  currentOutcome,
  composerView,
}: {
  compact: Exclude<ConversationSurfaceCapabilities["compact"], undefined>;
  thread: NonNullable<ConversationSurfaceCapabilities["thread"]>;
  surfaceInputs: ConversationSurfaceCapabilities;
  threadChatModel: Exclude<MainThreadReadCapabilities["threadChatModel"], undefined>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  historyActivityModel: Exclude<MainThreadReadCapabilities["historyActivityModel"], undefined>;
  historyActivityResourceId: Exclude<
    MainThreadReadCapabilities["historyActivityResourceId"],
    undefined
  >;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  newChat: Exclude<ConversationSurfaceCapabilities["newChat"], undefined>;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  readInputs: MainThreadReadCapabilities;
  currentUsage: Exclude<MainThreadReadCapabilities["currentUsage"], undefined>;
  accountRateLimitsDatabase: Exclude<
    ConversationAccountCapabilities["accountRateLimitsDatabase"],
    undefined
  >;
  accountsInputs: ConversationAccountCapabilities;
  readOnly: Exclude<ConversationSurfaceCapabilities["readOnly"], undefined>;
  archived: Exclude<ThreadConversationCapabilities["archived"], undefined>;
  pinned: Exclude<ThreadConversationCapabilities["pinned"], undefined>;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  threadRenameBinding: ReturnType<typeof useThreadRename>;
  actionsInputs: ThreadConversationCapabilities;
  deleteThread: ReturnType<typeof useTerminalDeletion>;
  requestPrompt: ReactNode;
  currentOutcome: Exclude<MainThreadReadCapabilities["currentOutcome"], undefined>;
  composerView: ReturnType<typeof createConversationComposerContent>;
}) {
  const headerContent = (
    <ConversationHeader
      compact={compact}
      onBack={surfaceInputs.onBack}
      thread={thread}
      threadChatModel={threadChatModel}
      draftConnectionId={draftConnectionId}
      draftThreadId={draftThreadId}
      historyActivityModel={historyActivityModel}
      historyActivityResourceId={historyActivityResourceId}
      server={surfaceInputs.server}
      cwd={cwd}
      newChat={newChat}
      threadSearchVisible={timelineState.timelineSearchStateBinding.threadSearchVisible}
      closeThreadSearch={timelineRead.timelineSearchActionsBinding.closeThreadSearch}
      setThreadSearchVisible={timelineState.timelineSearchStateBinding.setThreadSearchVisible}
      remoteThread={readInputs.remoteThread}
      currentUsage={currentUsage}
      sessionCompactionCount={timelineRead.conversationPresentationBinding.sessionCompactionCount}
      accountRateLimitsDatabase={accountRateLimitsDatabase}
      onRefreshAccountRateLimits={accountsInputs.onRefreshAccountRateLimits}
      readOnly={readOnly}
      archived={archived}
      pinned={pinned}
      dismissComposerKeyboardForOverlay={
        overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay
      }
      openThreadRename={threadRenameBinding.openThreadRename}
      onTogglePin={actionsInputs.onTogglePin}
      onUnarchive={actionsInputs.onUnarchive}
      onArchive={actionsInputs.onArchive}
      onCompact={actionsInputs.onCompact}
      onFork={actionsInputs.onFork}
      deleteThread={deleteThread}
    />
  );
  const searchContent = (
    <TimelineSearchBar
      threadSearch={timelineState.timelineSearchStateBinding.threadSearch}
      updateThreadSearch={timelineRead.timelineSearchActionsBinding.updateThreadSearch}
      setThreadSearchMatch={timelineState.timelineSearchStateBinding.setThreadSearchMatch}
      scrollToThreadSearchIndex={
        timelineRead.timelineSearchActionsBinding.scrollToThreadSearchIndex
      }
      threadSearchMatches={timelineRead.timelineSearchProjectionBinding.threadSearchMatches}
      threadSearchMatch={timelineState.timelineSearchStateBinding.threadSearchMatch}
      compact={compact}
      moveThreadSearch={timelineRead.timelineSearchActionsBinding.moveThreadSearch}
      closeThreadSearch={timelineRead.timelineSearchActionsBinding.closeThreadSearch}
    />
  );
  const jumpContent = (
    <JumpToLatest
      newItemCount={timelineRead.newItemCount}
      bottomChromeHeight={timelineState.timelineViewportStateBinding.bottomChromeHeight}
      jumpTimelineToLatest={timelineRead.historyAnchorActionsBinding.jumpTimelineToLatest}
    />
  );
  const bottomChrome = (
    <ConversationBottomChrome
      setBottomChromeHeight={timelineState.timelineViewportStateBinding.setBottomChromeHeight}
      readOnly={readOnly}
      requestPrompt={requestPrompt}
      timeline={timelineRead.conversationTimelineBinding.timeline}
      failureNotice={timelineRead.conversationPresentationBinding.failureNotice}
      remoteThread={readInputs.remoteThread}
      currentOutcome={currentOutcome}
      composerContent={composerView.composerContent}
    />
  );
  return { searchContent, jumpContent, headerContent, bottomChrome };
}
