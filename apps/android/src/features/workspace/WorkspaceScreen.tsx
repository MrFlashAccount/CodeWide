import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThreadListAccountRefresh } from "../accounts/threadListAccountRefresh";
import { useConnectionActions } from "../connections/connectionActions";
import { useConnectionProjection } from "../connections/connectionProjection";
import { useRenderRecovery } from "../diagnostics/renderRecovery";
import { createThreadNavigationModel } from "../navigation/threadNavigation";
import { useWorkspaceDeepLinks } from "../navigation/workspaceDeepLinks";
import { useBrowserFeedbackSubmission } from "../ports/browser/feedbackSubmission";
import { useBrowserNavigation } from "../ports/browserNavigation";
import { useNewChat, useNewChatVisibility } from "../projects/newChat";
import { usePendingRequests } from "../requests/pendingRequests";
import { useSettingsVisibility } from "../settings/SettingsFeature";
import { useThreadListActions } from "../threadList/threadListActions";
import type { ThreadListSources } from "../threadList/threadListSources";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import { useWindowLayout } from "./useWindowLayout";
import { useWorkspaceRuntime } from "./useWorkspaceRuntime";
import { useWorkspaceListBindings } from "./workspaceListBindings";
import { useWorkspaceProjectBindings } from "./workspaceProjectBindings";
import type { WorkspaceContentProps } from "./WorkspaceScreen.types";
import { renderWorkspaceScreenContent } from "./WorkspaceScreenContent";

/** Mounts the complete V1 workspace composition. */
export function WorkspaceScreen() {
  return <CodeWideWorkspaceScreen />;
}
function CodeWideWorkspaceScreen() {
  const windowLayout = useWindowLayout();
  const insets = useSafeAreaInsets();
  const runtime = useWorkspaceRuntime();
  const connections = useConnectionProjection(runtime.connectionProfiles, runtime.connectionState);
  const pendingRequests = usePendingRequests(runtime.pendingRequests);
  const [threadNavigation] = useState(createThreadNavigationModel);
  return (
    <CodeWideWorkspaceContent
      threadNavigation={threadNavigation}
      desktop={windowLayout.desktop}
      viewportWidth={windowLayout.width}
      insets={insets}
      runtime={runtime}
      connections={connections}
      pendingRequests={pendingRequests}
    />
  );
}

function CodeWideWorkspaceContent({
  desktop,
  viewportWidth,
  insets,
  runtime,
  connections,
  pendingRequests,
  threadNavigation,
}: WorkspaceContentProps) {
  const threadListSources: ThreadListSources = {
    threadSummaryDatabase: runtime.threadSummaries,
    accountRateLimitsDatabase: runtime.accountRateLimits,
    pendingRequests: pendingRequests,
  };
  const [newThreadVisible, setNewThreadVisible] = useNewChatVisibility();
  const [settingsVisible, setSettingsVisible] = useSettingsVisibility();
  const { loopbackBrowser, openBrowser, closeBrowser } = useBrowserNavigation();
  const list = useWorkspaceListBindings({
    connections,
    threadListSources,
    desktop,
    runtime,
    threadNavigation,
  });
  const browserFeedback = useBrowserFeedbackSubmission(
    connections,
    list.scopedThreads,
    list.servers,
    {
      transferAccess: features.attachments.transferAccess,
      sendText: features.composer.sendText,
    },
  );
  const project = useWorkspaceProjectBindings({ list, connections, runtime, newThreadVisible });
  const { refreshThreadListAccountRateLimits } = useThreadListAccountRefresh(
    list.servers,
    list.activeServerId,
    features.accounts.refreshAccountRateLimits,
  );
  const connectionActions = useConnectionActions(
    {
      addConnection: features.connections.addConnection,
      setConnectionEnabled: features.connections.setConnectionEnabled,
      reconnectConnection: features.connections.reconnectConnection,
      deleteConnection: features.connections.deleteConnection,
      updateConnectionProfile: features.connections.updateConnectionProfile,
      updateConnection: features.connections.updateConnection,
      moveConnection: features.connections.moveConnection,
    },
    list.settingsConnections,
    (added) => {
      if (threadNavigation.destination$.peek().kind === "draft") {
        list.setActiveServerId(added.id);
        return;
      }
      list.setActiveThreadId(null, undefined, added.id);
    },
  );
  const { openConnectionSheet, openPairingCode } = connectionActions;
  const { createSidebarThread, openNewChat } = useNewChat(
    setNewThreadVisible,
    threadNavigation,
    list.setActiveServerId,
    list.activeServerId,
    list.servers,
    list.projectSelection.sidebarProject,
    project.projectWorkspace.defaultProjectCwd,
    openConnectionSheet,
  );
  useWorkspaceDeepLinks(openPairingCode, list.setActiveThreadId);
  const { createUnsupportedFixThread, createRenderFailureFixThread } = useRenderRecovery(
    {
      startThread: features.projects.startThread,
      renameThread: features.turnActions.renameThread,
      sendText: features.composer.sendText,
    },
    threadNavigation,
    list.activeServerId,
    list.loadedThreadSummaries,
    list.setActiveThreadId,
  );

  const { toggleListThreadPin, archiveListThread, unarchiveListThread, markListThreadRead } =
    useThreadListActions(
      {
        setThreadPinned: features.turnActions.setThreadPinned,
        archiveThread: features.turnActions.archiveThread,
        unarchiveThread: features.turnActions.unarchiveThread,
        markThreadRead: features.turnActions.markThreadRead,
      },
      threadNavigation,
      list.setActiveThreadId,
    );
  return renderWorkspaceScreenContent({
    createRenderFailureFixThread,
    threadNavigation,
    runtime,
    list,
    browserFeedback,
    loopbackBrowser,
    insets,
    closeBrowser,
    desktop,
    threadListSources,
    projectLimit: project.projectLimit,
    loadMoreProjectThreads: project.loadMoreProjectThreads,
    projectWorkspace: project.projectWorkspace,
    sidebarCatalogState: project.sidebarCatalogState,
    sidebarMode: project.sidebarMode,
    sidebarFilter: project.sidebarFilter,
    changeSidebarMode: project.changeSidebarMode,
    changeSidebarFilter: project.changeSidebarFilter,
    sidebarSearch: project.sidebarSearch,
    createSidebarThread,
    toggleListThreadPin,
    archiveListThread,
    unarchiveListThread,
    markListThreadRead,
    refreshThreadListAccountRateLimits,
    threadSearch: project.threadSearch,
    viewportWidth,
    sidebarScopeKey: project.sidebarScopeKey,
    setSettingsVisible,
    connections,
    pendingRequests,
    openBrowser,
    createUnsupportedFixThread,
    connectionActions,
    settingsVisible,
    newThreadVisible,
    setNewThreadVisible,
    projectManagementSheet: project.projectManagementSheet,
    openNewChat,
  });
}
