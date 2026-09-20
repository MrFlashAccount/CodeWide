import {
  threadResourceKey,
  tunnelResourceKey,
  turnControlsResourceKey,
} from "../../data/workspace-resource-keys";
import { useTurnChangesLoader } from "../changes/turnChanges";
import { useGoalCommands } from "../goal/goalCommands";
import { useLoopbackNavigation } from "../ports/loopbackNavigation";
import { useActiveProjectSelection } from "../projects/activeProjectSelection";
import { createNewChatSubmission } from "../projects/newChatSubmission";
import { useQueueCommands } from "../queue/queueCommands";
import { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import { useActiveConversationScope } from "./activeConversationScope";
import { renderConversationDestinationSurface } from "./ConversationDestinationSurface";
import type { ConversationDestinationProps } from "./ConversationDetail";
import { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";

export function ActiveWorkspaceConversation(props: ActiveWorkspaceConversationProps) {
  const scope = useActiveConversationScope({
    connections: props.connections,
    destination: props.destination,
    loadedThreadSummaries: props.loadedThreadSummaries,
    onClose: props.onClose,
    onExitSearchHistory: props.onExitSearchHistory,
    scopedThreads: props.scopedThreads,
  });
  const projectSelection = useActiveProjectSelection(
    {
      addProject: props.features.projects.addProject,
      connections: props.connections,
      deleteThread: props.features.turnActions.deleteThread,
      inspectWorkspace: props.features.projects.inspectWorkspace,
      listProjects: props.features.projects.listProjects,
      native: props.native,
      readDirectory: props.features.projects.readDirectory,
      startThread: props.features.projects.startThread,
      threadDetails: props.runtime.threadDetails,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
    scope.activeStoredThread,
    scope.newChatDraft,
    props.onChangeDraftProject,
    props.onSelectThread,
  );
  const activeControlsResourceId =
    scope.activeConnectionId === ""
      ? null
      : turnControlsResourceKey(scope.activeConnectionId, scope.activeCwd);
  const activeThreadResourceId =
    scope.activeConnectionId === "" || scope.activeRemoteThreadId === null
      ? null
      : threadResourceKey(scope.activeConnectionId, scope.activeRemoteThreadId);
  const activeTunnelResourceId =
    scope.activeConnectionId === "" ? null : tunnelResourceKey(scope.activeConnectionId);
  const activePendingRequests = props.pendingRequests.filter(
    (request) =>
      request.connectionId === scope.activeConnectionId &&
      request.params.threadId === scope.activeRemoteThreadId,
  );
  const { forkCurrentThread, markActiveThreadRead } = useActiveThreadActions(
    {
      forkThread: props.features.turnActions.forkThread,
      markThreadRead: props.features.turnActions.markThreadRead,
      native: props.native,
    },
    scope.activeThread !== null,
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
    props.onSelectThread,
  );
  const { loadTurnChanges } = useTurnChangesLoader(props.features.conversation.loadTurnItems);

  const threadMutationActions = useThreadMutationActions(
    {
      archiveThread: props.features.turnActions.archiveThread,
      deleteThread: props.features.turnActions.deleteThread,
      renameThread: props.features.turnActions.renameThread,
      setThreadPinned: props.features.turnActions.setThreadPinned,
      unarchiveThread: props.features.turnActions.unarchiveThread,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
    scope.activeThreadId !== null,
    scope.activeThread?.pinned ?? false,
    props.onSelectThread,
    props.onShowActiveThreads,
  );
  const queueCommands = useQueueCommands(
    {
      cancelQueuedPrompt: props.features.queue.cancelQueuedPrompt,
      editQueuedPrompt: props.features.queue.editQueuedPrompt,
      listQueuedPrompts: props.features.queue.listQueuedPrompts,
      moveQueuedPrompt: props.features.queue.moveQueuedPrompt,
      steerQueuedPrompt: props.features.queue.steerQueuedPrompt,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
  );
  const goalCommands = useGoalCommands(
    {
      clearThreadGoal: props.features.goal.clearThreadGoal,
      getThreadGoal: props.features.goal.getThreadGoal,
      setThreadGoal: props.features.goal.setThreadGoal,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
  );
  const activeConversationNavigationKey =
    scope.newChatDraft !== null
      ? `new-chat:${scope.newChatDraft.connectionId}:${scope.newChatDraft.id}`
      : (scope.requestedThreadId ?? scope.activeThreadKey ?? "none");
  const activeConversationRoute: ConversationDestinationProps["route"] | null =
    scope.newChatDraft !== null
      ? {
          connectionId: scope.newChatDraft.connectionId,
          draftId: scope.newChatDraft.id,
          kind: "new",
          resources: {
            loadTurnItems: props.features.conversation.loadTurnItems,
            putThreadHistory: props.runtime.resources?.putThreadHistory,
            threadDetails: props.runtime.threadDetails,
            threadHistoryModel: props.runtime.resources?.threadHistories ?? null,
            threadSummaryDatabase: props.runtime.threadSummaries,
            threadUiStateDatabase: props.runtime.threadUiState,
          },
        }
      : scope.activeRemoteThreadId !== null && scope.activeConnectionId !== ""
        ? {
            connectionId: scope.activeConnectionId,
            kind: "thread",
            resources: {
              loadTurnItems: props.features.conversation.loadTurnItems,
              putThreadHistory: props.runtime.resources?.putThreadHistory,
              threadDetails: props.runtime.threadDetails,
              threadHistoryModel: props.runtime.resources?.threadHistories ?? null,
              threadSummaryDatabase: props.runtime.threadSummaries,
              threadUiStateDatabase: props.runtime.threadUiState,
            },
            threadId: scope.activeRemoteThreadId,
          }
        : null;
  const conversationActions = createConversationScopeBindings(
    props.features,
    scope.newChatDraft !== null
      ? {
          draft: scope.newChatDraft,
          kind: "draft",
          onSend: createNewChatSubmission({
            closeDraft: props.onDraftAdmitted,
            commands: {
              sendText: props.features.composer.sendText,
              startThread: props.features.projects.startThread,
              startThreadInWorkspace: props.features.projects.startThreadInWorkspace,
            },
            draftChat: scope.newChatDraft,
            setActiveThreadId: props.onSelectThread,
          }),
        }
      : scope.activeRemoteThreadId === null
        ? { kind: "empty" }
        : {
            connectionId: scope.activeConnectionId,
            kind: "thread",
            threadId: scope.activeRemoteThreadId,
          },
    queueCommands,
    goalCommands,
  );

  const openActiveLoopbackLink = useLoopbackNavigation(
    props.native,
    scope.activeConnectionId,
    props.onOpenBrowser,
  );

  return renderConversationDestinationSurface({
    activeControlsResourceId,
    activeConversationNavigationKey,
    activeConversationRoute,
    activeDiscoveredProjects: projectSelection.activeDiscoveredProjects,
    activePendingRequests,
    activeProjectError: projectSelection.activeProjectError,
    activeProjects: projectSelection.activeProjects,
    activeThreadResourceId,
    activeTunnelResourceId,
    activeWorkspaceSupport: projectSelection.activeWorkspaceSupport,
    addActiveProject: projectSelection.addActiveProject,
    changeEmptyThreadProject: projectSelection.changeEmptyThreadProject,
    conversationActions,
    desktop: props.desktop,
    destination: props.destination,
    features: props.features,
    fileTransferController: props.fileTransferController,
    forkCurrentThread,
    loadTurnChanges,
    markActiveThreadRead,
    native: props.native,
    onChangeDraftWorkspaceMode: props.onChangeDraftWorkspaceMode,
    onFixUnsupportedBlock: props.onFixUnsupportedBlock,
    onManageProjects: props.onManageProjects,
    onOpenBrowser: props.onOpenBrowser,
    openActiveLoopbackLink,
    readActiveDirectory: projectSelection.readActiveDirectory,
    runtime: props.runtime,
    scope,
    servers: props.servers,
    threadMutationActions,
    voiceController: props.voiceController,
  });
}
