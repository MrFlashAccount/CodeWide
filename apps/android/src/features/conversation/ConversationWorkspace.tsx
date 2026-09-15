import {
  threadResourceKey,
  tunnelResourceKey,
  turnControlsResourceKey,
} from "../../data/workspace-resource-keys";
import { useTurnChangesLoader } from "../changes/turnChanges";
import { useGoalCommands } from "../goal/goalCommands";
import { useLoopbackNavigation } from "../ports/browserNavigation";
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
    destination: props.destination,
    threadNavigation: props.threadNavigation,
    defaultDesktopThreadId: props.defaultDesktopThreadId,
    setActiveThreadId: props.onSelectThread,
    scopedThreads: props.scopedThreads,
    activeServerId: props.activeServerId,
    connections: props.connections,
    loadedThreadSummaries: props.loadedThreadSummaries,
  });
  const projectSelection = useActiveProjectSelection(
    {
      native: props.native,
      connections: props.connections,
      threadDetails: props.runtime.threadDetails,
      listProjects: props.features.projects.listProjects,
      addProject: props.features.projects.addProject,
      readDirectory: props.features.projects.readDirectory,
      inspectWorkspace: props.features.projects.inspectWorkspace,
      startThread: props.features.projects.startThread,
      deleteThread: props.features.turnActions.deleteThread,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
    scope.activeStoredThread,
    scope.newChatDraft,
    props.threadNavigation,
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
      native: props.native,
      forkThread: props.features.turnActions.forkThread,
      markThreadRead: props.features.turnActions.markThreadRead,
    },
    scope.activeThread !== null,
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
    props.onSelectThread,
  );
  const { loadTurnChanges } = useTurnChangesLoader(props.features.conversation.loadTurnItems);

  const threadMutationActions = useThreadMutationActions(
    {
      renameThread: props.features.turnActions.renameThread,
      archiveThread: props.features.turnActions.archiveThread,
      unarchiveThread: props.features.turnActions.unarchiveThread,
      deleteThread: props.features.turnActions.deleteThread,
      setThreadPinned: props.features.turnActions.setThreadPinned,
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
      listQueuedPrompts: props.features.queue.listQueuedPrompts,
      editQueuedPrompt: props.features.queue.editQueuedPrompt,
      cancelQueuedPrompt: props.features.queue.cancelQueuedPrompt,
      moveQueuedPrompt: props.features.queue.moveQueuedPrompt,
      steerQueuedPrompt: props.features.queue.steerQueuedPrompt,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
  );
  const goalCommands = useGoalCommands(
    {
      getThreadGoal: props.features.goal.getThreadGoal,
      setThreadGoal: props.features.goal.setThreadGoal,
      clearThreadGoal: props.features.goal.clearThreadGoal,
    },
    scope.activeConnectionId,
    scope.activeRemoteThreadId,
  );
  const activeConversationNavigationKey =
    scope.newChatDraft !== null
      ? `new-chat:${scope.newChatDraft.serverId}:${scope.newChatDraft.id}`
      : (scope.requestedThreadId ?? scope.activeThreadKey ?? "none");
  const activeConversationRoute: ConversationDestinationProps["route"] | null =
    scope.newChatDraft !== null
      ? {
          kind: "new",
          resources: {
            threadDetails: props.runtime.threadDetails,
            threadUiStateDatabase: props.runtime.threadUiState,
            threadSummaryDatabase: props.runtime.threadSummaries,
            threadHistoryModel: props.runtime.resources?.threadHistories ?? null,
            putThreadHistory: props.runtime.resources?.putThreadHistory,
            loadTurnItems: props.features.conversation.loadTurnItems,
          },
          connectionId: scope.newChatDraft.serverId,
          draftId: scope.newChatDraft.id,
        }
      : scope.activeRemoteThreadId !== null && scope.activeConnectionId !== ""
        ? {
            kind: "thread",
            resources: {
              threadDetails: props.runtime.threadDetails,
              threadUiStateDatabase: props.runtime.threadUiState,
              threadSummaryDatabase: props.runtime.threadSummaries,
              threadHistoryModel: props.runtime.resources?.threadHistories ?? null,
              putThreadHistory: props.runtime.resources?.putThreadHistory,
              loadTurnItems: props.features.conversation.loadTurnItems,
            },
            connectionId: scope.activeConnectionId,
            threadId: scope.activeRemoteThreadId,
            threadOpenGeneration: scope.threadOpenGeneration,
          }
        : null;
  const conversationActions = createConversationScopeBindings(
    props.features,
    scope.newChatDraft !== null
      ? {
          kind: "draft",
          draft: scope.newChatDraft,
          onSend: createNewChatSubmission(
            scope.newChatDraft,
            {
              startThread: props.features.projects.startThread,
              startThreadInWorkspace: props.features.projects.startThreadInWorkspace,
              sendText: props.features.composer.sendText,
            },
            props.onSelectThread,
          ),
        }
      : scope.activeRemoteThreadId === null
        ? { kind: "empty" }
        : {
            kind: "thread",
            connectionId: scope.activeConnectionId,
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

  if (!props.desktop && props.destination.kind === "empty") return null;
  return renderConversationDestinationSurface({
    desktop: props.desktop,
    destination: props.destination,
    defaultDesktopThreadId: props.defaultDesktopThreadId,
    scope,
    activeConversationNavigationKey,
    servers: props.servers,
    activeConversationRoute,
    features: props.features,
    runtime: props.runtime,
    conversationActions,
    activePendingRequests,
    markActiveThreadRead,
    voiceController: props.voiceController,
    activeControlsResourceId,
    threadNavigation: props.threadNavigation,
    onManageProjects: props.onManageProjects,
    threadMutationActions,
    forkCurrentThread,
    loadTurnChanges,
    activeThreadResourceId,
    fileTransferController: props.fileTransferController,
    activeTunnelResourceId,
    native: props.native,
    onOpenBrowser: props.onOpenBrowser,
    openActiveLoopbackLink,
    onFixUnsupportedBlock: props.onFixUnsupportedBlock,
    activeProjects: projectSelection.activeProjects,
    activeDiscoveredProjects: projectSelection.activeDiscoveredProjects,
    activeProjectError: projectSelection.activeProjectError,
    changeEmptyThreadProject: projectSelection.changeEmptyThreadProject,
    activeWorkspaceSupport: projectSelection.activeWorkspaceSupport,
    addActiveProject: projectSelection.addActiveProject,
    readActiveDirectory: projectSelection.readActiveDirectory,
  });
}
