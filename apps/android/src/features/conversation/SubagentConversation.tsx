import type { RenderBlock } from "@codewide/renderers";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database-contract";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../../data/use-thread-history-controller";
import { ContentReviewComposer } from "../../rendering/ContentReviewHost";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import { useEvent } from "../../react/useEvent";
import { useAppVoiceInputRuntime, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { subagentThreadListItem } from "../agents/agentSelection";
import { ComposerSubagentContextChip } from "../agents/ComposerSubagentContextChip";
import type { SubagentThreadView } from "../agents/subagentConversationContract";
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
import { ConversationReadSurface } from "./ConversationReadSurface";
import { useConversationRouteNavigation } from "./conversationRouteNavigation";
import {
  useOverlayScrollOwnership,
  useOverlayScrollState,
} from "./timeline/overlayScrollOwnership";
import { usePaginationTrim, useTimelineViewportState } from "./timeline/timelineViewport";

/** Binds only the navigation, preview and terminal capabilities exposed by a read-only child. */
export type SubagentConversationProps = {
  details: ThreadDetailDatabase | null;
  fixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  getTransferAccess: GetTransferAccess | undefined;
  loadTurnChanges: ((target: TurnChangesTarget) => Promise<readonly TurnChangedFile[]>) | undefined;
  refresh: ((rootThreadId: string) => Promise<void>) | undefined;
  server: ThreadListServer | undefined;
  summaries: ThreadSummaryDatabase | null;
  view: SubagentThreadView;
};

export function SubagentConversation({
  details,
  fixUnsupportedBlock,
  getTransferAccess,
  loadTurnChanges,
  refresh,
  server,
  summaries,
  view,
}: SubagentConversationProps) {
  const { compact, connectionId, onBack, onOpenSubagent, thread } = view;
  const routeNavigation = useConversationRouteNavigation();
  const scope = `${connectionId}\u0000${thread.id}`;
  const viewport = useTimelineViewportState(scope);
  const overlayState = useOverlayScrollState();
  const pagination = usePaginationTrim({
    fullscreenScrollOwnership: overlayState.fullscreenScrollOwnership,
    historyViewport: COMPLETE_STATIC_THREAD_HISTORY,
    paginationEdgeLockRef: viewport.paginationEdgeLockRef,
    paginationTrimTimerRef: viewport.paginationTrimTimerRef,
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
  const { currentChangePresentation, currentThreadResources } = useChangeResourcePresentation(
    null,
    null,
    changesPreferences,
  );
  const getStableTransferAccess = useDocumentTransferAccess(getTransferAccess);
  // Read-only children have never admitted review uploads into a draft.
  const { openCodeDocument, presentTurnChanges } = useChangesFeature({
    appVoiceInputRuntime,
    attachCodeReview: async () => false,
    changesPreferences,
    currentChangePresentation,
    currentThreadResources,
    cwd: thread.cwd,
    getStableTransferAccess,
    onLoadThreadChangeDiff: undefined,
    onLoadThreadResources: undefined,
    onLoadTurnChanges: loadTurnChanges,
    remoteThread: thread,
    setChangesPreferences,
  });
  useReviewFeature(scope, null, thread, appVoiceInputRuntime, null, undefined, async () => null);
  const openTimelineDocument = useEvent(
    (request: Parameters<typeof routeNavigation.openDocument>[0]) => {
      if (request.kind === "text") {
        openCodeDocument(request);
        return;
      }
      routeNavigation.openDocument(request);
    },
  );
  const { openThreadDocumentLink } = useDocumentNavigation(
    thread.cwd,
    getTransferAccess,
    getStableTransferAccess,
    undefined,
    openTimelineDocument,
  );
  const openChildren = useEvent(
    (_children: readonly StoredThreadSummary[], initialThreadId: string | null = null) => {
      void refresh?.(thread.id).catch(() => undefined);
      routeNavigation.openAgents(initialThreadId, thread.id);
    },
  );
  const presentTerminal = useEvent(() => {
    routeNavigation.openTerminal({ connectionId, cwd: thread.cwd, threadId: thread.id });
  });
  const { openTerminal } = useTerminalActions(connectionId, thread.id, thread.cwd, presentTerminal);
  return (
    <ConversationReadSurface
      appVoiceInputRuntime={appVoiceInputRuntime}
      compact={compact}
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
              onOpen={(children) => {
                openChildren(children);
              }}
            />
          )}
        </ReadOnlyComposerContext>
      }
      getStableTransferAccess={getStableTransferAccess}
      getTransferAccess={getTransferAccess}
      onBack={onBack}
      onFixUnsupportedBlock={fixUnsupportedBlock}
      onOpenSubagentThread={onOpenSubagent}
      openCodeDocument={openTimelineDocument}
      openThreadDocumentLink={openThreadDocumentLink}
      overlay={overlay}
      overlayState={overlayState}
      pagination={pagination}
      presentTurnChanges={presentTurnChanges}
      remoteThread={thread}
      reviewContent={<ContentReviewComposer targetPrefix="agent-response:" />}
      server={server}
      thread={subagentThreadListItem(view.summary, thread, connectionId)}
      viewport={viewport}
    />
  );
}
