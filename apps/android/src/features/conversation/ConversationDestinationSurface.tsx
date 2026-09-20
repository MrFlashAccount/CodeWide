import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import type { useTurnChangesLoader } from "../changes/turnChanges";
import type { useLoopbackNavigation } from "../ports/loopbackNavigation";
import type { useActiveProjectSelection } from "../projects/activeProjectSelection";
import type { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import type { useActiveConversationScope } from "./activeConversationScope";
import { ConversationDestination } from "./ConversationDestination";
import type { ConversationDestinationProps } from "./ConversationDetail";
import type { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";
import { renderConversationWorkspaceContent } from "./ConversationWorkspaceContent";

/** Presents the selected destination under local recovery while its data publishes progressively. */
export function renderConversationDestinationSurface(props: {
  activeControlsResourceId: string | null;
  activeConversationNavigationKey: string;
  activeConversationRoute: ConversationDestinationProps["route"] | null;
  activeDiscoveredProjects: ReturnType<
    typeof useActiveProjectSelection
  >["activeDiscoveredProjects"];
  activePendingRequests: ActiveWorkspaceConversationProps["pendingRequests"];
  activeProjectError: ReturnType<typeof useActiveProjectSelection>["activeProjectError"];
  activeProjects: ReturnType<typeof useActiveProjectSelection>["activeProjects"];
  activeThreadResourceId: string | null;
  activeTunnelResourceId: string | null;
  activeWorkspaceSupport: ReturnType<typeof useActiveProjectSelection>["activeWorkspaceSupport"];
  addActiveProject: ReturnType<typeof useActiveProjectSelection>["addActiveProject"];
  changeEmptyThreadProject: ReturnType<
    typeof useActiveProjectSelection
  >["changeEmptyThreadProject"];
  conversationActions: ReturnType<typeof createConversationScopeBindings>;
  desktop: ActiveWorkspaceConversationProps["desktop"];
  destination: ActiveWorkspaceConversationProps["destination"];
  features: ActiveWorkspaceConversationProps["features"];
  fileTransferController: ActiveWorkspaceConversationProps["fileTransferController"];
  forkCurrentThread: ReturnType<typeof useActiveThreadActions>["forkCurrentThread"];
  loadTurnChanges: ReturnType<typeof useTurnChangesLoader>["loadTurnChanges"];
  markActiveThreadRead: ReturnType<typeof useActiveThreadActions>["markActiveThreadRead"];
  native: ActiveWorkspaceConversationProps["native"];
  onChangeDraftWorkspaceMode: ActiveWorkspaceConversationProps["onChangeDraftWorkspaceMode"];
  onFixUnsupportedBlock: ActiveWorkspaceConversationProps["onFixUnsupportedBlock"];
  onManageProjects: ActiveWorkspaceConversationProps["onManageProjects"];
  onOpenBrowser: ActiveWorkspaceConversationProps["onOpenBrowser"];
  openActiveLoopbackLink: ReturnType<typeof useLoopbackNavigation>;
  readActiveDirectory: ReturnType<typeof useActiveProjectSelection>["readActiveDirectory"];
  runtime: ActiveWorkspaceConversationProps["runtime"];
  scope: ReturnType<typeof useActiveConversationScope>;
  servers: ActiveWorkspaceConversationProps["servers"];
  threadMutationActions: ReturnType<typeof useThreadMutationActions>;
  voiceController: ActiveWorkspaceConversationProps["voiceController"];
}) {
  return (
    <RecoverableRenderBoundary
      context={`Connection: ${props.scope.activeConnectionId}\nThread: ${props.scope.composerThreadId ?? "none"}`}
      label="Conversation"
      onDismiss={props.scope.closeActiveConversation}
      resetKey={`${props.scope.activeConnectionId}:${props.scope.composerThreadId ?? "none"}`}
      scope="surface"
    >
      {props.activeConversationRoute === null ? null : (
        <ConversationDestination
          cwd={props.scope.activeCwd}
          navigationKey={props.activeConversationNavigationKey}
          onExitSearchHistory={props.scope.exitSearchHistory}
          renderContent={(snapshot) =>
            renderConversationWorkspaceContent({
              activeConnectionId: props.scope.activeConnectionId,
              activeConnectionState: props.scope.activeConnectionState,
              activeControlsResourceId: props.activeControlsResourceId,
              activeDiscoveredProjects: props.activeDiscoveredProjects,
              activePendingRequests: props.activePendingRequests,
              activeProjectError: props.activeProjectError,
              activeProjects: props.activeProjects,
              activeThread: props.scope.activeThread,
              activeThreadResourceId: props.activeThreadResourceId,
              activeTunnelResourceId: props.activeTunnelResourceId,
              activeWorkspaceSupport: props.activeWorkspaceSupport,
              addActiveProject: props.addActiveProject,
              changeEmptyThreadProject: props.changeEmptyThreadProject,
              closeActiveConversation: props.scope.closeActiveConversation,
              conversationActions: props.conversationActions,
              desktop: props.desktop,
              features: props.features,
              fileTransferController: props.fileTransferController,
              forkCurrentThread: props.forkCurrentThread,
              loadTurnChanges: props.loadTurnChanges,
              markActiveThreadRead: props.markActiveThreadRead,
              native: props.native,
              newChatDraft: props.scope.newChatDraft,
              onChangeDraftWorkspaceMode: props.onChangeDraftWorkspaceMode,
              onFixUnsupportedBlock: props.onFixUnsupportedBlock,
              onManageProjects: props.onManageProjects,
              onOpenBrowser: props.onOpenBrowser,
              openActiveLoopbackLink: props.openActiveLoopbackLink,
              readActiveDirectory: props.readActiveDirectory,
              runtime: props.runtime,
              servers: props.servers,
              snapshot,
              threadMutationActions: props.threadMutationActions,
              visibleConversationThread: props.scope.visibleConversationThread,
              voiceController: props.voiceController,
            })
          }
          route={props.activeConversationRoute}
          searchWindow={props.scope.searchWindow}
        />
      )}
    </RecoverableRenderBoundary>
  );
}
