import { ConversationComposition } from "./ConversationComposition";
import type { RenderConversationWorkspaceContentProps } from "./ConversationWorkspaceContent.types";
/** Joins one resolved detail snapshot with the independently scoped feature surfaces. */
export function renderConversationWorkspaceContent(props: RenderConversationWorkspaceContentProps) {
  return (
    <ConversationComposition
      requests={{
        pendingRequest: props.activePendingRequests[0] ?? null,
        pendingRequestCount: props.activePendingRequests.length,
        onRespondToRequest: props.conversationActions.onRespondToRequest,
      }}
      surface={{
        thread: props.visibleConversationThread,
        server: props.servers.find((server) => server.id === props.activeConnectionId),
        newChat: props.newChatDraft !== null,
        compact: !props.desktop,
        readOnly: false,
        onBack: props.desktop ? undefined : props.closeActiveConversation,
        cwd: props.snapshot.cwd ?? "/workspace",
        unread: props.activeThread?.unread ?? 0,
        onViewedLatest: props.markActiveThreadRead,
      }}
      read={{
        searchWindow: props.snapshot.searchWindow ?? null,
        onExitSearchHistory: undefined,
        remoteThread: props.snapshot.remoteThread,
        currentUsage: props.snapshot.currentUsage ?? null,
        currentOutcome: props.snapshot.currentOutcome ?? null,
        remoteSealedTurns: props.snapshot.remoteSealedTurns,
        remoteLiveTurns: props.snapshot.remoteLiveTurns,
        timelineEntries: props.snapshot.timelineEntries,
        historyViewport: props.snapshot.historyViewport,
        historyActivityModel: props.snapshot.historyActivityModel ?? null,
        historyActivityResourceId: props.snapshot.historyActivityResourceId ?? null,
        threadChatModel: props.snapshot.threadChatModel ?? null,
        onLoadTurnItems: props.snapshot.onLoadTurnItems,
        composerState: props.snapshot.composerState,
        historyRestoreReady: props.snapshot.historyRestoreReady,
        messageListState: props.snapshot.messageListState ?? { status: "ready" },
        liveTextRecovery: props.snapshot.liveTextRecovery ?? false,
        loadScrollOffset: props.features.conversation.loadScrollOffset,
        saveScrollOffset: props.features.conversation.saveScrollOffset,
      }}
      composer={{
        onSend: props.conversationActions.onSend,
        onRetryFailedMessage: props.conversationActions.onRetryFailedMessage,
        loadDraft: props.features.composer.loadDraft,
        saveDraft: props.features.composer.saveDraft,
        saveDraftAttachments: props.features.composer.saveDraftAttachments,
        upsertDraftAttachment: props.features.composer.upsertDraftAttachment,
        removeDraftAttachment: props.features.composer.removeDraftAttachment,
        saveComposerPreferences: props.features.composer.saveComposerPreferences,
        onLoadControls: props.conversationActions.onLoadControls,
        onUpdateSettings: props.conversationActions.onUpdateSettings,
        onInterrupt: props.conversationActions.onInterrupt,
        workspaceResources: props.runtime.resources,
        controlsResourceId: props.activeControlsResourceId,
        voiceController: props.voiceController,
        onStartVoiceTranscription: props.conversationActions.onStartVoiceTranscription,
      }}
      queue={{
        queuedPrompts: props.snapshot.queuedPrompts,
        onListQueue: props.conversationActions.onListQueue,
        onEditQueued: props.conversationActions.onEditQueued,
        onCancelQueued: props.conversationActions.onCancelQueued,
        onMoveQueued: props.conversationActions.onMoveQueued,
        onSteerQueued: props.conversationActions.onSteerQueued,
      }}
      projects={{
        projects: props.activeProjects,
        discoveredProjects: props.activeDiscoveredProjects,
        projectLoadError: props.activeProjectError,
        onChangeProject: props.changeEmptyThreadProject,
        workspaceSupport: props.activeWorkspaceSupport,
        workspaceMode: props.newChatDraft?.workspaceMode ?? "current",
        onChangeWorkspaceMode: (workspaceMode) => {
          if (props.newChatDraft !== null)
            props.onChangeDraftWorkspaceMode(props.newChatDraft.id, workspaceMode);
        },
        onAddProject: props.addActiveProject,
        onReadDirectory: props.readActiveDirectory,
        onManageProjects: props.onManageProjects,
      }}
      actions={{
        onRename: props.threadMutationActions.onRename,
        onArchive: props.threadMutationActions.onArchive,
        onUnarchive: props.threadMutationActions.onUnarchive,
        onDelete: props.threadMutationActions.onDelete,
        archived: props.activeThread?.archived ?? false,
        pinned: props.activeThread?.pinned ?? false,
        onTogglePin: props.threadMutationActions.onTogglePin,
        onCompact: props.conversationActions.onCompact,
        onFork: props.forkCurrentThread,
      }}
      accounts={{
        accountRateLimitsDatabase: props.runtime.accountRateLimits,
        onRefreshAccountRateLimits:
          props.activeConnectionId === ""
            ? undefined
            : async () =>
                await props.features.accounts.refreshAccountRateLimits(props.activeConnectionId),
      }}
      changes={{
        onLoadTurnChanges: props.loadTurnChanges,
        threadResourcesModel: props.runtime.resources?.threadResources ?? null,
        threadResourceId: props.activeThreadResourceId,
        threadResourceRevision: props.activeConnectionState,
        onLoadThreadResources: props.conversationActions.onLoadThreadResources,
        onLoadThreadChangeDiff: props.conversationActions.onLoadThreadChangeDiff,
      }}
      attachments={{
        fileTransferController: props.fileTransferController,
        getTransferAccess: props.conversationActions.getTransferAccess,
      }}
      agents={{
        subagentSummaryDatabase: props.snapshot.subagentSummaryDatabase,
        subagentThreadDetails: props.runtime.threadDetails,
        onRefreshSubagents: async (rootThreadId: string) =>
          await props.features.agents.refreshSubagents(props.activeConnectionId, rootThreadId),
        onOpenSubagentThread: undefined,
      }}
      ports={{
        tunnelResourceId: props.activeTunnelResourceId,
        portForwardingConnectionId:
          props.native && props.activeConnectionId !== "" ? props.activeConnectionId : null,
        portForwardingServerName:
          props.servers.find((server) => server.id === props.activeConnectionId)?.name ?? "Server",
        onOpenPortForward: props.onOpenBrowser,
        onOpenLoopbackLink: props.openActiveLoopbackLink,
        onCreateTunnel: props.conversationActions.onCreateTunnel,
        onRevokeTunnel: props.conversationActions.onRevokeTunnel,
      }}
      terminal={{
        backgroundTerminalsResourceId: props.activeThreadResourceId,
        onListTerminals: props.conversationActions.onListTerminals,
        onTerminateTerminal: props.conversationActions.onTerminateTerminal,
      }}
      goal={{
        goalResourceId: props.activeThreadResourceId,
        onGetGoal: props.conversationActions.onGetGoal,
        onSetGoal: props.conversationActions.onSetGoal,
        onClearGoal: props.conversationActions.onClearGoal,
      }}
      review={{ onStartReview: props.conversationActions.onStartReview }}
      diagnostics={{ onFixUnsupportedBlock: props.onFixUnsupportedBlock }}
    />
  );
}
