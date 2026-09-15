import type { JSX } from "react";
import { View } from "react-native";
import { workspaceRuntime } from "../../data/workspace-runtime";
import { RenderRecoveryProvider } from "../../ui/RecoverableRenderBoundary";
import { WorkspaceVoiceAura } from "../../ui/WorkspaceVoiceAura";
import { useThreadListAccountRefresh } from "../accounts/threadListAccountRefresh";
import { useConnectionActions } from "../connections/connectionActions";
import { ActiveWorkspaceConversation } from "../conversation/ConversationWorkspace";
import { useRenderRecovery } from "../diagnostics/renderRecovery";
import {
  WorkspaceConversationHost,
  WorkspaceThreadListVisibility,
} from "../navigation/ConversationHost";
import { useBrowserFeedbackSubmission } from "../ports/browser/feedbackSubmission";
import { useBrowserNavigation } from "../ports/browserNavigation";
import { ForwardedLoopbackBrowser } from "../ports/ForwardedLoopbackBrowser";
import { useNewChat, useNewChatVisibility } from "../projects/newChat";
import { useProjectWorkspace } from "../projects/projectWorkspace";
import { useThreadSearch } from "../search/threadSearch";
import { useSettingsVisibility } from "../settings/SettingsFeature";
import { useProjectThreadList } from "../threadList/projectThreadList";
import { sidebarListState } from "../threadList/SidebarListFeedback";
import { useThreadListActions } from "../threadList/threadListActions";
import type { ThreadListSources } from "../threadList/threadListSources";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import { WorkspaceConversationProviders } from "./WorkspaceConversationProviders";
import { useWorkspaceListBindings } from "./workspaceListBindings";
import { WorkspaceOverlays } from "./WorkspaceOverlays";
import { styles } from "./WorkspaceScreen.styles";
import type { WorkspaceContentProps } from "./WorkspaceScreen.types";
import { WorkspaceThreadList } from "./WorkspaceThreadList";

/** Responsive workspace view composes retained feature surfaces without owning their state. */
export function renderWorkspaceScreenContent(props: {
  createRenderFailureFixThread: ReturnType<
    typeof useRenderRecovery
  >["createRenderFailureFixThread"];
  threadNavigation: WorkspaceContentProps["threadNavigation"];
  runtime: WorkspaceContentProps["runtime"];
  list: ReturnType<typeof useWorkspaceListBindings>;
  browserFeedback: ReturnType<typeof useBrowserFeedbackSubmission>;
  loopbackBrowser: ReturnType<typeof useBrowserNavigation>["loopbackBrowser"];
  insets: WorkspaceContentProps["insets"];
  closeBrowser: ReturnType<typeof useBrowserNavigation>["closeBrowser"];
  desktop: WorkspaceContentProps["desktop"];
  threadListSources: ThreadListSources;
  projectLimit: ReturnType<typeof useProjectThreadList>["projectLimit"];
  loadMoreProjectThreads: ReturnType<typeof useProjectThreadList>["loadMoreProjectThreads"];
  projectWorkspace: ReturnType<typeof useProjectWorkspace>;
  sidebarCatalogState: ReturnType<typeof sidebarListState>;
  sidebarMode: ReturnType<typeof useProjectThreadList>["sidebarMode"];
  sidebarFilter: ReturnType<typeof useProjectThreadList>["sidebarFilter"];
  changeSidebarMode: ReturnType<typeof useProjectThreadList>["changeSidebarMode"];
  changeSidebarFilter: ReturnType<typeof useProjectThreadList>["changeSidebarFilter"];
  sidebarSearch: JSX.Element | null;
  createSidebarThread: ReturnType<typeof useNewChat>["createSidebarThread"];
  toggleListThreadPin: ReturnType<typeof useThreadListActions>["toggleListThreadPin"];
  archiveListThread: ReturnType<typeof useThreadListActions>["archiveListThread"];
  unarchiveListThread: ReturnType<typeof useThreadListActions>["unarchiveListThread"];
  markListThreadRead: ReturnType<typeof useThreadListActions>["markListThreadRead"];
  refreshThreadListAccountRateLimits: ReturnType<
    typeof useThreadListAccountRefresh
  >["refreshThreadListAccountRateLimits"];
  threadSearch: ReturnType<typeof useThreadSearch>;
  viewportWidth: WorkspaceContentProps["viewportWidth"];
  sidebarScopeKey: ReturnType<typeof useProjectThreadList>["sidebarScopeKey"];
  setSettingsVisible: ReturnType<typeof useSettingsVisibility>[1];
  connections: WorkspaceContentProps["connections"];
  pendingRequests: WorkspaceContentProps["pendingRequests"];
  openBrowser: ReturnType<typeof useBrowserNavigation>["openBrowser"];
  createUnsupportedFixThread: ReturnType<typeof useRenderRecovery>["createUnsupportedFixThread"];
  connectionActions: ReturnType<typeof useConnectionActions>;
  settingsVisible: ReturnType<typeof useSettingsVisibility>[0];
  newThreadVisible: ReturnType<typeof useNewChatVisibility>[0];
  setNewThreadVisible: ReturnType<typeof useNewChatVisibility>[1];
  projectManagementSheet: JSX.Element;
  openNewChat: ReturnType<typeof useNewChat>["openNewChat"];
}) {
  return (
    <RenderRecoveryProvider onFix={props.createRenderFailureFixThread}>
      <WorkspaceConversationProviders
        navigation={props.threadNavigation}
        runtime={props.runtime}

        fallbackServerId={props.list.activeServerId}
        feedback={props.browserFeedback}
      >
        {props.loopbackBrowser !== null ? (
          <ForwardedLoopbackBrowser
            title={props.loopbackBrowser.title}
            url={props.loopbackBrowser.url}
            topInset={props.insets.top}
            bottomInset={props.insets.bottom}
            onClose={props.closeBrowser}
          />
        ) : (
          <WorkspaceVoiceAura
            resources={props.runtime.resources}
            controller={workspaceRuntime.voiceController}
          >
            <View
              style={[
                styles.root,
                { paddingTop: props.insets.top, paddingBottom: props.insets.bottom },
              ]}
            >
              <View style={props.desktop ? styles.desktopWorkspace : styles.flex}>
                <WorkspaceThreadListVisibility
                  navigation={props.threadNavigation}
                  desktop={props.desktop}
                >
                  {
                    <WorkspaceThreadList
                      threadListSources={props.threadListSources}
                      projectLimit={props.projectLimit}
                      loadMoreProjectThreads={props.loadMoreProjectThreads}
                      sidebarProject={props.list.projectSelection.sidebarProject}
                      pinnedSidebarProjects={props.projectWorkspace.pinnedSidebarProjects}
                      openSidebarProject={props.list.projectSelection.openSidebarProject}
                      closeSidebarProject={props.list.projectSelection.closeSidebarProject}
                      sidebarCatalogState={props.sidebarCatalogState}
                      servers={props.list.servers}
                      activeServerId={props.list.activeServerId}
                      serverThreads={props.list.serverThreads}
                      archivedThreads={props.list.archivedThreads}
                      sidebarMode={props.sidebarMode}
                      sidebarFilter={props.sidebarFilter}
                      threadNavigation={props.threadNavigation}
                      changeSidebarMode={props.changeSidebarMode}
                      changeSidebarFilter={props.changeSidebarFilter}
                      loadMoreThreads={props.list.loadMoreThreads}
                      selectThread={props.list.selectThread}
                      openGlobalSearch={props.list.openGlobalSearch}
                      sidebarSearch={props.sidebarSearch}
                      preloadThread={props.list.preloadThread}
                      selectServer={props.list.selectServer}
                      createSidebarThread={props.createSidebarThread}
                      toggleListThreadPin={props.toggleListThreadPin}
                      archiveListThread={props.archiveListThread}
                      unarchiveListThread={props.unarchiveListThread}
                      markListThreadRead={props.markListThreadRead}
                      refreshThreadListAccountRateLimits={props.refreshThreadListAccountRateLimits}
                      mobileVisibleThreads={props.threadSearch.mobileVisibleThreads}
                      mobileVisibleArchivedThreads={props.threadSearch.mobileVisibleArchivedThreads}
                      desktop={props.desktop}
                      viewportWidth={props.viewportWidth}
                      sidebarScopeKey={props.sidebarScopeKey}
                      mobileThreadOffset={props.list.listState.mobileThreadOffset}
                      setProjectsSheetVisible={props.list.projectSelection.setProjectsSheetVisible}
                      setSettingsVisible={props.setSettingsVisible}
                      normalizedMobileThreadQuery={props.threadSearch.normalizedMobileThreadQuery}
                      mobileRemoteSearchResource={props.threadSearch.mobileRemoteSearchResource}
                      mobileThreadQuery={props.list.listState.mobileThreadQuery}
                      setMobileThreadQuery={props.list.listState.setMobileThreadQuery}
                    />
                  }
                </WorkspaceThreadListVisibility>
                <WorkspaceConversationHost
                  navigation={props.threadNavigation}
                  renderConversation={(destination) => (
                    <ActiveWorkspaceConversation
                      features={features}
                      native={workspaceRuntime.native}
                      voiceController={workspaceRuntime.voiceController}
                      fileTransferController={workspaceRuntime.fileTransferController}
                      destination={destination}
                      runtime={props.runtime}
                      connections={props.connections}
                      pendingRequests={props.pendingRequests}
                      threadNavigation={props.threadNavigation}
                      desktop={props.desktop}
                      activeServerId={props.list.activeServerId}
                      servers={props.list.servers}
                      scopedThreads={props.list.scopedThreads}
                      loadedThreadSummaries={props.list.loadedThreadSummaries}
                      defaultDesktopThreadId={props.list.defaultDesktopThreadId}
                      onSelectThread={props.list.setActiveThreadId}
                      onOpenBrowser={props.openBrowser}
                      onManageProjects={() =>
                        props.list.projectSelection.setProjectsSheetVisible(true)
                      }
                      onShowActiveThreads={() => props.list.listState.setThreadListMode("active")}
                      onFixUnsupportedBlock={props.createUnsupportedFixThread}
                    />
                  )}
                />
              </View>
              <WorkspaceOverlays
                connectionActions={props.connectionActions}
                settingsVisible={props.settingsVisible}
                setSettingsVisible={props.setSettingsVisible}
                newThreadVisible={props.newThreadVisible}
                setNewThreadVisible={props.setNewThreadVisible}
                settingsConnections={props.list.settingsConnections}
                runtime={props.runtime}
                projectManagementSheet={props.projectManagementSheet}
                servers={props.list.servers}
                openNewChat={props.openNewChat}
                defaultProjectCwd={props.projectWorkspace.defaultProjectCwd}
              />
            </View>
          </WorkspaceVoiceAura>
        )}
      </WorkspaceConversationProviders>
    </RenderRecoveryProvider>
  );
}
