import { Suspense } from "react";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import type { useTurnChangesLoader } from "../changes/turnChanges";
import type { useLoopbackNavigation } from "../ports/browserNavigation";
import type { useActiveProjectSelection } from "../projects/activeProjectSelection";
import type { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import type { useActiveConversationScope } from "./activeConversationScope";
import { ConversationDestination } from "./ConversationDestination";
import type { ConversationDestinationProps } from "./ConversationDetail";
import { ConversationNavigationFallback } from "./ConversationNavigationBoundary";
import type { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";
import { renderConversationWorkspaceContent } from "./ConversationWorkspaceContent";

/** Presents the selected destination under its existing local recovery and Suspense boundary. */
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
      <Suspense
        fallback={
          <ConversationNavigationFallback
            compact={!props.desktop}
            connectionId={props.scope.activeConnectionId}
            cwd={props.scope.activeCwd}
            navigationKey={props.activeConversationNavigationKey}
            onBack={props.desktop ? undefined : props.scope.closeActiveConversation}
            server={props.servers.find((server) => server.id === props.scope.activeConnectionId)}
            thread={props.scope.visibleConversationThread}
            threadId={props.scope.activeRemoteThreadId}
          />
        }
      >
        {props.activeConversationRoute === null ? null : (
          <ConversationDestination
            cwd={props.scope.activeCwd}
            navigationKey={props.activeConversationNavigationKey}
            onExitSearchHistory={props.scope.exitSearchHistory}
            renderContent={(snapshot) =>
              renderConversationWorkspaceContent({
                snapshot,
                features: props.features,
                runtime: props.runtime,
                conversationActions: props.conversationActions,
                activePendingRequests: props.activePendingRequests,
                visibleConversationThread: props.scope.visibleConversationThread,
                servers: props.servers,
                activeConnectionId: props.scope.activeConnectionId,
                newChatDraft: props.scope.newChatDraft,
                desktop: props.desktop,
                closeActiveConversation: props.scope.closeActiveConversation,
                activeThread: props.scope.activeThread,
                markActiveThreadRead: props.markActiveThreadRead,
                voiceController: props.voiceController,
                activeControlsResourceId: props.activeControlsResourceId,
                onManageProjects: props.onManageProjects,
                threadMutationActions: props.threadMutationActions,
                forkCurrentThread: props.forkCurrentThread,
                loadTurnChanges: props.loadTurnChanges,
                activeThreadResourceId: props.activeThreadResourceId,
                activeConnectionState: props.scope.activeConnectionState,
                fileTransferController: props.fileTransferController,
                activeTunnelResourceId: props.activeTunnelResourceId,
                native: props.native,
                onOpenBrowser: props.onOpenBrowser,
                openActiveLoopbackLink: props.openActiveLoopbackLink,
                onFixUnsupportedBlock: props.onFixUnsupportedBlock,
                activeProjects: props.activeProjects,
                activeDiscoveredProjects: props.activeDiscoveredProjects,
                activeProjectError: props.activeProjectError,
                changeEmptyThreadProject: props.changeEmptyThreadProject,
                activeWorkspaceSupport: props.activeWorkspaceSupport,
                addActiveProject: props.addActiveProject,
                readActiveDirectory: props.readActiveDirectory,
                onChangeDraftWorkspaceMode: props.onChangeDraftWorkspaceMode,
              })
            }
            route={props.activeConversationRoute}
            searchWindow={props.scope.searchWindow}
          />
        )}
      </Suspense>
    </RecoverableRenderBoundary>
  );
}
