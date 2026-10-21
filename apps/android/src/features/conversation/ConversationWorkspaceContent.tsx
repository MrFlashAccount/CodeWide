import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  projectedThreadExecutionSettings,
  type ProjectedThreadExecutionSettings,
} from "@codewide/sync-client";
import { agentProviders } from "../../data/workspace-runtime";
import { threadRefusesDirectInput } from "../../data/threadDirectInput";
import { ConversationComposition } from "./ConversationComposition";
import { forkOffer, type ForkThreadSettings } from "../turnActions/forkTargets";
import { threadAgentAccounts, threadAgentActions } from "./threadAgentActions";
import type { RenderConversationWorkspaceContentProps } from "./ConversationWorkspaceContent.types";
/**
 * Joins one resolved detail snapshot with the independently scoped feature surfaces.
 * Thread actions the bound agent does not declare are passed as `undefined`, which
 * every feature already renders as a hidden or disabled control.
 */
export function renderConversationWorkspaceContent(props: RenderConversationWorkspaceContentProps) {
  const listedThread = props.visibleConversationThread;
  const remoteThread = props.snapshot.remoteThread;
  const gated = threadAgentActions(
    remoteThread,
    props.conversationActions,
    props.forkCurrentThread,
  );
  // Directly opened chats can be excluded from the catalog. Their detail snapshot
  // supplies the title without inserting a synthetic row into the ordinary list.
  const visibleThread =
    props.activeThread === null && listedThread !== null && remoteThread !== null
      ? { ...listedThread, title: remoteThread.name ?? "Chat" }
      : listedThread;
  return (
    <ConversationComposition
      accounts={threadAgentAccounts(
        remoteThread,
        {
          accountRateLimitsDatabase: props.runtime.accountRateLimits,
          onRefreshAccountRateLimits:
            props.activeConnectionId === ""
              ? undefined
              : async () =>
                  props.features.accounts.refreshAccountRateLimits(props.activeConnectionId, true),
        },
        props.activeConnectionId === ""
          ? null
          : { agentProviders, connectionId: props.activeConnectionId },
      )}
      actions={{
        archived: props.activeThread?.archived ?? false,
        forkOffer:
          gated.onFork === undefined
            ? undefined
            : () =>
                forkOffer(
                  remoteThread,
                  serverThreadSettings(remoteThread),
                  props.runtime.resources?.turnControls.get(props.activeControlsResourceId ?? "")
                    ?.value?.models ?? [],
                ),
        onArchive: props.threadMutationActions.onArchive,
        onCompact: gated.onCompact,
        onDelete: props.threadMutationActions.onDelete,
        onFork: gated.onFork,
        onRename: props.threadMutationActions.onRename,
        onTogglePin: props.threadMutationActions.onTogglePin,
        onUnarchive: props.threadMutationActions.onUnarchive,
        pinned: props.activeThread?.pinned ?? false,
      }}
      agents={{
        onOpenSubagentThread: undefined,
        onReadBackgroundTask:
          props.activeConnectionId === ""
            ? undefined
            : async (threadId: string, taskId: string, offset: number) =>
                props.features.agents.readBackgroundTask(props.activeConnectionId, {
                  offset,
                  taskId,
                  threadId,
                }),
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
        onLoadThreadChangeDiff: gated.onLoadThreadChangeDiff,
        onLoadThreadResources: gated.onLoadThreadResources,
        onLoadTurnChanges: props.loadTurnChanges,
        threadResourceId: props.activeThreadResourceId,
        threadResourceRevision: props.activeConnectionState,
        threadResourcesModel: props.runtime.resources?.threadResources ?? null,
      }}
      composer={{
        controlsResourceId: props.activeControlsResourceId,
        loadDraft: props.features.composer.loadDraft,
        onContinueTurn: props.conversationActions.onContinueTurn,
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
        captureGoalLifecycle: gated.captureGoalLifecycle,
        goalResourceId: props.activeThreadResourceId,
        onClearGoal: gated.onClearGoal,
        onGetGoal: gated.onGetGoal,
        onSetGoal: gated.onSetGoal,
        onSetGoalStatus: gated.onSetGoalStatus,
      }}
      ports={{
        onOpenBrowser: props.onOpenBrowser,
        onOpenLoopbackLink: props.openActiveLoopbackLink,
        portForwardingConnectionId:
          props.native && props.activeConnectionId !== "" ? props.activeConnectionId : null,
        portForwardingServerName:
          props.servers.find((server) => server.id === props.activeConnectionId)?.name ?? "Server",
      }}
      projects={{
        discoveredProjects: props.activeDiscoveredProjects,
        newChatPicker: props.newChatPicker,
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
      review={{ onStartReview: gated.onStartReview }}
      surface={{
        compact: !props.desktop,
        cwd: props.snapshot.cwd ?? "/workspace",
        firstUnreadAgentTurnId: props.snapshot.firstUnreadAgentTurnId ?? null,
        newChat: props.newChatDraft !== null,
        onBack: props.desktop ? undefined : props.closeActiveConversation,
        onViewedLatest: props.markActiveThreadRead,
        // A thread another process holds opens read-only until it lets go; a
        // sub-agent, driven by its parent agent, is always read-only.
        readOnly: threadRefusesDirectInput(remoteThread),
        recheckThread:
          props.activeConnectionId === "" || remoteThread === null
            ? undefined
            : async () => {
                await props.features.conversation.readThread(
                  props.activeConnectionId,
                  remoteThread.id,
                  undefined,
                  true,
                );
              },
        server: props.servers.find((server) => server.id === props.activeConnectionId),
        thread: visibleThread,
        unread: props.activeThread?.unread ?? 0,
      }}
      terminal={{
        backgroundTerminalsResourceId: props.activeThreadResourceId,
        onListTerminals: gated.onListTerminals,
        onTerminateTerminal: gated.onTerminateTerminal,
      }}
    />
  );
}

/** The settings the server reports for the thread, the composer chips' settled values. */
function serverThreadSettings(thread: Thread | null): ForkThreadSettings {
  const settings = thread === null ? null : projectedThreadExecutionSettings(thread);
  return settings === null ? NO_SERVER_SETTINGS : forkSettings(settings);
}

const NO_SERVER_SETTINGS: ForkThreadSettings = {
  effort: null,
  model: null,
  modelLabel: null,
  serviceTier: null,
};

function forkSettings(settings: ProjectedThreadExecutionSettings): ForkThreadSettings {
  return {
    effort: settings.effort,
    model: settings.model,
    modelLabel: settings.modelLabel ?? null,
    serviceTier: settings.serviceTier ?? null,
  };
}
