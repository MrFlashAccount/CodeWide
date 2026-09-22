import { ConversationComposition } from "./ConversationComposition";
import type { RenderConversationWorkspaceContentProps } from "./ConversationWorkspaceContent.types";
/** Joins one resolved detail snapshot with the independently scoped feature surfaces. */
export function renderConversationWorkspaceContent(props: RenderConversationWorkspaceContentProps) {
  const listedThread = props.visibleConversationThread;
  const remoteThread = props.snapshot.remoteThread;
  // Directly opened chats can be excluded from the catalog. Their detail snapshot
  // supplies the title without inserting a synthetic row into the ordinary list.
  const visibleThread =
    props.activeThread === null && listedThread !== null && remoteThread !== null
      ? { ...listedThread, title: remoteThread.name ?? "Chat" }
      : listedThread;
  return (
    <ConversationComposition
      accounts={{
        accountRateLimitsDatabase: props.runtime.accountRateLimits,
        onRefreshAccountRateLimits:
          props.activeConnectionId === ""
            ? undefined
            : async () =>
                props.features.accounts.refreshAccountRateLimits(props.activeConnectionId),
      }}
      actions={{
        archived: props.activeThread?.archived ?? false,
        onArchive: props.threadMutationActions.onArchive,
        onCompact: props.conversationActions.onCompact,
        onDelete: props.threadMutationActions.onDelete,
        onFork: props.forkCurrentThread,
        onRename: props.threadMutationActions.onRename,
        onTogglePin: props.threadMutationActions.onTogglePin,
        onUnarchive: props.threadMutationActions.onUnarchive,
        pinned: props.activeThread?.pinned ?? false,
      }}
      agents={{
        onOpenSubagentThread: undefined,
        onRefreshSubagents: async (rootThreadId: string) => {
          await props.features.agents.refreshSubagents(props.activeConnectionId, rootThreadId);
        },
        subagentSummaryDatabase: props.snapshot.subagentSummaryDatabase,
        subagentThreadDetails: props.runtime.threadDetails,
      }}
      attachments={{
        fileTransferController: props.fileTransferController,
        getTransferAccess: props.conversationActions.getTransferAccess,
      }}
      changes={{
        onLoadThreadChangeDiff: props.conversationActions.onLoadThreadChangeDiff,
        onLoadThreadResources: props.conversationActions.onLoadThreadResources,
        onLoadTurnChanges: props.loadTurnChanges,
        threadResourceId: props.activeThreadResourceId,
        threadResourceRevision: props.activeConnectionState,
        threadResourcesModel: props.runtime.resources?.threadResources ?? null,
      }}
      composer={{
        controlsResourceId: props.activeControlsResourceId,
        loadDraft: props.features.composer.loadDraft,
        onInterrupt: props.conversationActions.onInterrupt,
        onLoadControls: props.conversationActions.onLoadControls,
        onRetryFailedMessage: props.conversationActions.onRetryFailedMessage,
        onSend: props.conversationActions.onSend,
        onStartVoiceTranscription: props.conversationActions.onStartVoiceTranscription,
        onUpdateSettings: props.conversationActions.onUpdateSettings,
        removeDraftAttachment: props.features.composer.removeDraftAttachment,
        saveComposerPreferences: props.features.composer.saveComposerPreferences,
        saveDraft: props.features.composer.saveDraft,
        saveDraftAttachments: props.features.composer.saveDraftAttachments,
        upsertDraftAttachment: props.features.composer.upsertDraftAttachment,
        voiceController: props.voiceController,
        workspaceResources: props.runtime.resources,
      }}
      diagnostics={{ onFixUnsupportedBlock: props.onFixUnsupportedBlock }}
      goal={{
        goalResourceId: props.activeThreadResourceId,
        onClearGoal: props.conversationActions.onClearGoal,
        onGetGoal: props.conversationActions.onGetGoal,
        onSetGoal: props.conversationActions.onSetGoal,
      }}
      ports={{
        onCreateTunnel: props.conversationActions.onCreateTunnel,
        onOpenBrowser: props.onOpenBrowser,
        onOpenLoopbackLink: props.openActiveLoopbackLink,
        onRevokeTunnel: props.conversationActions.onRevokeTunnel,
        portForwardingConnectionId:
          props.native && props.activeConnectionId !== "" ? props.activeConnectionId : null,
        portForwardingServerName:
          props.servers.find((server) => server.id === props.activeConnectionId)?.name ?? "Server",
        tunnelResourceId: props.activeTunnelResourceId,
      }}
      projects={{
        discoveredProjects: props.activeDiscoveredProjects,
        onAddProject: props.addActiveProject,
        onChangeProject: props.changeEmptyThreadProject,
        onChangeWorkspaceMode: (workspaceMode) => {
          if (props.newChatDraft !== null) {
            props.onChangeDraftWorkspaceMode(props.newChatDraft.id, workspaceMode);
          }
        },
        onManageProjects: props.onManageProjects,
        onReadDirectory: props.readActiveDirectory,
        projectLoadError: props.activeProjectError,
        projects: props.activeProjects,
        workspaceMode: props.newChatDraft?.workspaceMode ?? "current",
        workspaceSupport: props.activeWorkspaceSupport,
      }}
      queue={{
        onCancelQueued: props.conversationActions.onCancelQueued,
        onEditQueued: props.conversationActions.onEditQueued,
        onListQueue: props.conversationActions.onListQueue,
        onMoveQueued: props.conversationActions.onMoveQueued,
        onSteerQueued: props.conversationActions.onSteerQueued,
        queuedPrompts: props.snapshot.queuedPrompts,
      }}
      read={{
        composerState: props.snapshot.composerState,
        currentOutcome: props.snapshot.currentOutcome ?? null,
        currentUsage: props.snapshot.currentUsage ?? null,
        historyActivityModel: props.snapshot.historyActivityModel ?? null,
        historyActivityResourceId: props.snapshot.historyActivityResourceId ?? null,
        historyRestoreReady: props.snapshot.historyRestoreReady,
        historyViewport: props.snapshot.historyViewport,
        liveTextRecovery: props.snapshot.liveTextRecovery ?? false,
        loadScrollOffset: props.features.conversation.loadScrollOffset,
        messageListState: props.snapshot.messageListState ?? { status: "ready" },
        onExitSearchHistory: undefined,
        onLoadTurnItems: props.snapshot.onLoadTurnItems,
        remoteLiveTurns: props.snapshot.remoteLiveTurns,
        remoteSealedTurns: props.snapshot.remoteSealedTurns,
        remoteThread: props.snapshot.remoteThread,
        saveScrollOffset: props.features.conversation.saveScrollOffset,
        searchWindow: props.snapshot.searchWindow ?? null,
        threadChatModel: props.snapshot.threadChatModel ?? null,
        timelineEntries: props.snapshot.timelineEntries,
      }}
      requests={{
        onRespondToRequest: props.conversationActions.onRespondToRequest,
        pendingRequest: props.activePendingRequests[0] ?? null,
        pendingRequestCount: props.activePendingRequests.length,
        questionSummaries: props.features.requests.getQuestionSummaries(),
        sendQuestionAnswer: props.features.requests.sendQuestionAnswer,
      }}
      review={{ onStartReview: props.conversationActions.onStartReview }}
      surface={{
        compact: !props.desktop,
        cwd: props.snapshot.cwd ?? "/workspace",
        newChat: props.newChatDraft !== null,
        onBack: props.desktop ? undefined : props.closeActiveConversation,
        onViewedLatest: props.markActiveThreadRead,
        readOnly: false,
        server: props.servers.find((server) => server.id === props.activeConnectionId),
        thread: visibleThread,
        unread: props.activeThread?.unread ?? 0,
      }}
      terminal={{
        backgroundTerminalsResourceId: props.activeThreadResourceId,
        onListTerminals: props.conversationActions.onListTerminals,
        onTerminateTerminal: props.conversationActions.onTerminateTerminal,
      }}
    />
  );
}
