import type { ReactNode } from "react";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationAccountCapabilities } from "../accounts/conversationAccountCapabilities";
import type { useTerminalDeletion } from "../terminal/terminalActions";
import type { useThreadRename } from "../turnActions/threadRename";
import { ConversationBottomChrome } from "./ConversationBottomChrome";
import type { createConversationComposerContent } from "./ConversationComposerContent";
import { ConversationHeader } from "./header/ConversationHeader";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import type { useConversationTimelineState } from "./timeline/conversationTimelineState";
import { JumpToLatest } from "./timeline/JumpToLatest";
import type { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import { TimelineSearchBar } from "./timeline/TimelineSearchBar";

export function createConversationChromeContent({
  accountRateLimitsDatabase,
  accountsInputs,
  actionsInputs,
  archived,
  compact,
  composerView,
  currentOutcome,
  currentUsage,
  cwd,
  deleteThread,
  draftConnectionId,
  draftThreadId,
  historyActivityModel,
  historyActivityResourceId,
  newChat,
  overlayScrollOwnershipBinding,
  pinned,
  readInputs,
  readOnly,
  requestPrompt,
  surfaceInputs,
  thread,
  threadChatModel,
  threadRenameBinding,
  timelineRead,
  timelineState,
}: {
  accountRateLimitsDatabase: Exclude<
    ConversationAccountCapabilities["accountRateLimitsDatabase"],
    undefined
  >;
  accountsInputs: ConversationAccountCapabilities;
  actionsInputs: ThreadConversationCapabilities;
  archived: Exclude<ThreadConversationCapabilities["archived"], undefined>;
  compact: Exclude<ConversationSurfaceCapabilities["compact"], undefined>;
  composerView: ReturnType<typeof createConversationComposerContent>;
  currentOutcome: Exclude<MainThreadReadCapabilities["currentOutcome"], undefined>;
  currentUsage: Exclude<MainThreadReadCapabilities["currentUsage"], undefined>;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  deleteThread: ReturnType<typeof useTerminalDeletion>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  historyActivityModel: Exclude<MainThreadReadCapabilities["historyActivityModel"], undefined>;
  historyActivityResourceId: Exclude<
    MainThreadReadCapabilities["historyActivityResourceId"],
    undefined
  >;
  newChat: Exclude<ConversationSurfaceCapabilities["newChat"], undefined>;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  pinned: Exclude<ThreadConversationCapabilities["pinned"], undefined>;
  readInputs: MainThreadReadCapabilities;
  readOnly: Exclude<ConversationSurfaceCapabilities["readOnly"], undefined>;
  requestPrompt: ReactNode;
  surfaceInputs: ConversationSurfaceCapabilities;
  thread: NonNullable<ConversationSurfaceCapabilities["thread"]>;
  threadChatModel: Exclude<MainThreadReadCapabilities["threadChatModel"], undefined>;
  threadRenameBinding: ReturnType<typeof useThreadRename>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  timelineState: ReturnType<typeof useConversationTimelineState>;
}) {
  const headerContent = (
    <ConversationHeader
      accountRateLimitsDatabase={accountRateLimitsDatabase}
      archived={archived}
      closeThreadSearch={timelineRead.timelineSearchActionsBinding.closeThreadSearch}
      compact={compact}
      currentUsage={currentUsage}
      cwd={cwd}
      deleteThread={deleteThread}
      dismissComposerKeyboardForOverlay={
        overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay
      }
      draftConnectionId={draftConnectionId}
      draftThreadId={draftThreadId}
      historyActivityModel={historyActivityModel}
      historyActivityResourceId={historyActivityResourceId}
      newChat={newChat}
      onArchive={actionsInputs.onArchive}
      onBack={surfaceInputs.onBack}
      onCompact={actionsInputs.onCompact}
      onFork={actionsInputs.onFork}
      onRefreshAccountRateLimits={accountsInputs.onRefreshAccountRateLimits}
      onTogglePin={actionsInputs.onTogglePin}
      onUnarchive={actionsInputs.onUnarchive}
      openThreadRename={threadRenameBinding.openThreadRename}
      pinned={pinned}
      readOnly={readOnly}
      remoteThread={readInputs.remoteThread}
      server={surfaceInputs.server}
      sessionCompactionCount={timelineRead.conversationPresentationBinding.sessionCompactionCount}
      setThreadSearchVisible={timelineState.timelineSearchStateBinding.setThreadSearchVisible}
      thread={thread}
      threadChatModel={threadChatModel}
      threadSearchVisible={timelineState.timelineSearchStateBinding.threadSearchVisible}
    />
  );
  const searchContent = (
    <TimelineSearchBar
      closeThreadSearch={timelineRead.timelineSearchActionsBinding.closeThreadSearch}
      compact={compact}
      moveThreadSearch={timelineRead.timelineSearchActionsBinding.moveThreadSearch}
      scrollToThreadSearchIndex={
        timelineRead.timelineSearchActionsBinding.scrollToThreadSearchIndex
      }
      setThreadSearchMatch={timelineState.timelineSearchStateBinding.setThreadSearchMatch}
      threadSearch={timelineState.timelineSearchStateBinding.threadSearch}
      threadSearchMatch={timelineState.timelineSearchStateBinding.threadSearchMatch}
      threadSearchMatches={timelineRead.timelineSearchProjectionBinding.threadSearchMatches}
      updateThreadSearch={timelineRead.timelineSearchActionsBinding.updateThreadSearch}
    />
  );
  const jumpContent = (
    <JumpToLatest
      bottomChromeHeight={timelineState.timelineViewportStateBinding.bottomChromeHeight}
      jumpTimelineToLatest={timelineRead.historyAnchorActionsBinding.jumpTimelineToLatest}
      newItemCount={timelineRead.newItemCount}
    />
  );
  const bottomChrome = (
    <ConversationBottomChrome
      composerContent={composerView.composerContent}
      currentOutcome={currentOutcome}
      failureNotice={timelineRead.conversationPresentationBinding.failureNotice}
      readOnly={readOnly}
      remoteThread={readInputs.remoteThread}
      requestPrompt={requestPrompt}
      setBottomChromeHeight={timelineState.timelineViewportStateBinding.setBottomChromeHeight}
      timeline={timelineRead.conversationTimelineBinding.timeline}
    />
  );
  return { bottomChrome, headerContent, jumpContent, searchContent };
}
