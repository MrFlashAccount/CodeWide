import { Suspense } from "react";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { useTurnChangesLoader } from "../changes/turnChanges";
import { useLoopbackNavigation } from "../ports/browserNavigation";
import { useActiveProjectSelection } from "../projects/activeProjectSelection";
import { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import { useActiveConversationScope } from "./activeConversationScope";
import { ConversationDestination } from "./ConversationDestination";
import type { ConversationDestinationProps } from "./ConversationDetail";
import { ConversationNavigationFallback } from "./ConversationNavigationBoundary";
import { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";
import { renderConversationWorkspaceContent } from "./ConversationWorkspaceContent";

/** Presents the selected destination under its existing local recovery and Suspense boundary. */
export function renderConversationDestinationSurface(props: {
  desktop: ActiveWorkspaceConversationProps["desktop"];
  destination: ActiveWorkspaceConversationProps["destination"];
  defaultDesktopThreadId: ActiveWorkspaceConversationProps["defaultDesktopThreadId"];
  scope: ReturnType<typeof useActiveConversationScope>;
  activeConversationNavigationKey: string;
  servers: ActiveWorkspaceConversationProps["servers"];
  activeConversationRoute: ConversationDestinationProps["route"] | null;
  features: ActiveWorkspaceConversationProps["features"];
  runtime: ActiveWorkspaceConversationProps["runtime"];
  conversationActions: ReturnType<typeof createConversationScopeBindings>;
  activePendingRequests: ActiveWorkspaceConversationProps["pendingRequests"];
  markActiveThreadRead: ReturnType<typeof useActiveThreadActions>["markActiveThreadRead"];
  voiceController: ActiveWorkspaceConversationProps["voiceController"];
  activeControlsResourceId: string | null;
  threadNavigation: ActiveWorkspaceConversationProps["threadNavigation"];
  onManageProjects: ActiveWorkspaceConversationProps["onManageProjects"];
  threadMutationActions: ReturnType<typeof useThreadMutationActions>;
  forkCurrentThread: ReturnType<typeof useActiveThreadActions>["forkCurrentThread"];
  loadTurnChanges: ReturnType<typeof useTurnChangesLoader>["loadTurnChanges"];
  activeThreadResourceId: string | null;
  fileTransferController: ActiveWorkspaceConversationProps["fileTransferController"];
  activeTunnelResourceId: string | null;
  native: ActiveWorkspaceConversationProps["native"];
  onOpenBrowser: ActiveWorkspaceConversationProps["onOpenBrowser"];
  openActiveLoopbackLink: ReturnType<typeof useLoopbackNavigation>;
  onFixUnsupportedBlock: ActiveWorkspaceConversationProps["onFixUnsupportedBlock"];
  activeProjects: ReturnType<typeof useActiveProjectSelection>["activeProjects"];
  activeDiscoveredProjects: ReturnType<
    typeof useActiveProjectSelection
  >["activeDiscoveredProjects"];
  activeProjectError: ReturnType<typeof useActiveProjectSelection>["activeProjectError"];
  changeEmptyThreadProject: ReturnType<
    typeof useActiveProjectSelection
  >["changeEmptyThreadProject"];
  activeWorkspaceSupport: ReturnType<typeof useActiveProjectSelection>["activeWorkspaceSupport"];
  addActiveProject: ReturnType<typeof useActiveProjectSelection>["addActiveProject"];
  readActiveDirectory: ReturnType<typeof useActiveProjectSelection>["readActiveDirectory"];
}) {
  return (
    <>
      {props.desktop && (
        <CommitOnChangeProbe
          scope="desktop-default-thread"
          revision={props.destination.kind === "empty" ? props.defaultDesktopThreadId : null}
          onCommit={props.scope.commitDefaultDesktopThread}
        />
      )}
      <RecoverableRenderBoundary
        scope="surface"
        label="Conversation"
        context={`Connection: ${props.scope.activeConnectionId}\nThread: ${props.scope.composerThreadId ?? "none"}`}
        resetKey={`${props.scope.activeConnectionId}:${props.scope.composerThreadId ?? "none"}`}
        onDismiss={props.scope.closeActiveConversation}
      >
        <Suspense
          fallback={
            <ConversationNavigationFallback
              connectionId={props.scope.activeConnectionId}
              threadId={props.scope.activeRemoteThreadId}
              navigationKey={props.activeConversationNavigationKey}
              thread={props.scope.visibleConversationThread}
              server={props.servers.find((server) => server.id === props.scope.activeConnectionId)}
              cwd={props.scope.activeCwd}
              compact={!props.desktop}
              onBack={props.desktop ? undefined : props.scope.closeActiveConversation}
            />
          }
        >
          {props.activeConversationRoute === null ? null : (
            <ConversationDestination
              searchWindow={props.scope.searchWindow}
              onExitSearchHistory={props.scope.exitSearchHistory}
              route={props.activeConversationRoute}
              navigationKey={props.activeConversationNavigationKey}
              cwd={props.scope.activeCwd}
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
                  threadNavigation: props.threadNavigation,
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
                })
              }
            />
          )}
        </Suspense>
      </RecoverableRenderBoundary>
    </>
  );
}
