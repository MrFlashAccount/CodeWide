import type { RenderBlock } from "@codewide/renderers";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database-contract";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../../data/use-thread-history-controller";
import { ContentReviewComposer } from "../../rendering/ContentReviewHost";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import { useAppVoiceInputRuntime, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { subagentThreadListItem } from "../agents/agentSelection";
import { useAgentsFeature } from "../agents/AgentsFeature";
import { ComposerSubagentContextChip } from "../agents/ComposerSubagentContextChip";
import type { SubagentThreadView } from "../agents/SubagentSheet";
import {
  useDocumentNavigation,
  useDocumentTransferAccess,
} from "../attachments/documentNavigation";
import {
  useChangeResourcePresentation,
  useChangesPreferences,
} from "../changes/changePresentation";
import { useChangesFeature } from "../changes/ChangesFeature";
import { ReadOnlyComposerContext } from "../composer/ReadOnlyComposerContext";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { useReviewFeature } from "../review/ReviewFeature";
import { ComposerTerminalContextChip } from "../terminal/ComposerTerminalContextChip";
import { useTerminalActions } from "../terminal/terminalActions";
import { useTerminalFeature } from "../terminal/TerminalFeature";
import { ConversationReadSurface } from "./ConversationReadSurface";
import {
  useOverlayScrollOwnership,
  useOverlayScrollState,
} from "./timeline/overlayScrollOwnership";
import { usePaginationTrim, useTimelineViewportState } from "./timeline/timelineViewport";

/** Binds only the navigation, preview and terminal capabilities exposed by a read-only child. */
export type SubagentConversationProps = {
  view: SubagentThreadView;
  server: ThreadListServer | undefined;
  summaries: ThreadSummaryDatabase | null;
  details: ThreadDetailDatabase | null;
  refresh: ((rootThreadId: string) => Promise<void>) | undefined;
  loadTurnChanges: ((target: TurnChangesTarget) => Promise<readonly TurnChangedFile[]>) | undefined;
  getTransferAccess: GetTransferAccess | undefined;
  fixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
};

export function SubagentConversation({
  view,
  server,
  summaries,
  details,
  refresh,
  loadTurnChanges,
  getTransferAccess,
  fixUnsupportedBlock,
}: SubagentConversationProps) {
  const { connectionId, thread, compact, onBack, onOpenSubagent } = view;
  const scope = `${connectionId}\u0000${thread.id}`;
  const viewport = useTimelineViewportState(scope);
  const overlayState = useOverlayScrollState();
  const pagination = usePaginationTrim({
    paginationTrimTimerRef: viewport.paginationTrimTimerRef,
    paginationEdgeLockRef: viewport.paginationEdgeLockRef,
    fullscreenScrollOwnership: overlayState.fullscreenScrollOwnership,
    historyViewport: COMPLETE_STATIC_THREAD_HISTORY,
  });
  const overlay = useOverlayScrollOwnership(
    scope,
    overlayState.fullscreenScrollOwnership,
    pagination.cancelScheduledPaginationTrim,
  );
  const parentVoice = useAppVoiceInputRuntime();
  const appVoiceInputRuntime: AppVoiceInputRuntime = {
    controller: parentVoice?.controller ?? null,
    resources: parentVoice?.resources ?? null,
    scopePrefix: scope,
    thread,
  };
  const { changesPreferences, setChangesPreferences } = useChangesPreferences(scope);
  const { currentThreadResources, currentChangePresentation } = useChangeResourcePresentation(
    null,
    null,
    changesPreferences,
  );
  const getStableTransferAccess = useDocumentTransferAccess(getTransferAccess);
  // Read-only children have never admitted review uploads into a draft.
  const { presentTurnChanges, openCodeDocument } = useChangesFeature({
    cwd: thread.cwd,
    remoteThread: thread,
    changesPreferences,
    setChangesPreferences,
    dismissComposerKeyboardForOverlay: overlay.dismissComposerKeyboardForOverlay,
    fullscreenOverlay: overlay.fullscreenOverlay,
    appVoiceInputRuntime,
    getStableTransferAccess,
    attachCodeReview: async () => false,
    onLoadTurnChanges: loadTurnChanges,
    onLoadThreadResources: undefined,
    onLoadThreadChangeDiff: undefined,
    currentThreadResources,
    currentChangePresentation,
  });
  useReviewFeature(scope, null, thread, appVoiceInputRuntime, null, undefined, async () => null);
  const { openThreadDocumentLink } = useDocumentNavigation(
    thread.cwd,
    getTransferAccess,
    getStableTransferAccess,
    undefined,
    (request) => openCodeDocument(request),
  );
  const renderChild = (child: SubagentThreadView) => (
    <SubagentConversation
      key={`${child.connectionId}:${child.thread.id}`}
      view={child}
      server={server}
      summaries={summaries}
      details={details}
      refresh={refresh}
      loadTurnChanges={loadTurnChanges}
      getTransferAccess={getTransferAccess}
      fixUnsupportedBlock={fixUnsupportedBlock}
    />
  );
  const openChildren = useAgentsFeature(
    connectionId,
    thread.id,
    thread,
    details,
    refresh,
    overlay.fullscreenOverlay,
    renderChild,
  );
  const presentTerminal = useTerminalFeature(
    connectionId,
    thread.id,
    thread.cwd,
    overlay.fullscreenOverlay,
  );
  const { openTerminal } = useTerminalActions(connectionId, thread.id, thread.cwd, presentTerminal);
  return (
    <ConversationReadSurface
      thread={subagentThreadListItem(view.summary, thread, connectionId)}
      server={server}
      remoteThread={thread}
      compact={compact}
      onBack={onBack}
      onOpenSubagentThread={onOpenSubagent}
      getTransferAccess={getTransferAccess}
      getStableTransferAccess={getStableTransferAccess}
      onFixUnsupportedBlock={fixUnsupportedBlock}
      openThreadDocumentLink={openThreadDocumentLink}
      openCodeDocument={openCodeDocument}
      presentTurnChanges={presentTurnChanges}
      appVoiceInputRuntime={appVoiceInputRuntime}
      viewport={viewport}
      overlayState={overlayState}
      overlay={overlay}
      pagination={pagination}
      reviewContent={<ContentReviewComposer targetPrefix="agent-response:" />}
      footerContent={
        <ReadOnlyComposerContext thread={thread}>
          <ComposerTerminalContextChip
            connectionId={connectionId}
            threadId={thread.id}
            onOpen={openTerminal}
          />
          {details === null ? null : (
            <ComposerSubagentContextChip
              database={summaries}
              connectionId={connectionId}
              parentThreadId={thread.id}
              onOpen={(children) => openChildren(children)}
            />
          )}
        </ReadOnlyComposerContext>
      }
    />
  );
}
