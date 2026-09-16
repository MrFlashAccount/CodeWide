import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThreadListAccountRefresh } from "../../src/features/accounts/threadListAccountRefresh";
import { useConnectionActions } from "../../src/features/connections/connectionActions";
import { useConnectionProjection } from "../../src/features/connections/connectionProjection";
import { useRenderRecovery } from "../../src/features/diagnostics/renderRecovery";
import { useBrowserFeedbackSubmission } from "../../src/features/ports/browser/feedbackSubmission";
import { resolveNewThreadRoute } from "../../src/features/projects/newThreadRouting";
import { usePendingRequests } from "../../src/features/requests/pendingRequests";
import { useThreadListActions } from "../../src/features/threadList/threadListActions";
import type { ThreadListSources } from "../../src/features/threadList/threadListSources";
import { useV1WorkspaceDeepLinks } from "../../src/features/workspace/useV1WorkspaceDeepLinks";
import { useWindowLayout } from "../../src/features/workspace/useWindowLayout";
import { useWorkspaceListBindings } from "../../src/features/workspace/workspaceListBindings";
import { useWorkspaceProjectBindings } from "../../src/features/workspace/workspaceProjectBindings";
import { useWorkspaceRuntime } from "../../src/features/workspace/useWorkspaceRuntime";
import { browserRouteSessions } from "../../src/services/browser/browserRouteSession";
import { pairingRouteSessions } from "../../src/services/connections/pairingRouteSession";
import { searchRouteSessions } from "../../src/services/search/searchRouteSession";
import { newThreadService } from "../../src/services/threads/newThreadService";
import { workspaceRouteSessionOwner } from "../../src/services/threads/threadRouteParams";
import type { WorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { useEvent } from "../../src/react/useEvent";
import { V1WorkspaceShell } from "./V1WorkspaceShell";
import { V1WorkspaceThreadList } from "./V1WorkspaceThreadList";
import { ensureV1NewThreadRoute, useV1WorkspaceRouteModel } from "./V1WorkspaceRouteModel";
import { v1WorkspaceCapabilities } from "./v1WorkspaceCapabilities";

/** Composes the mounted V1 route resources, list chrome, and active destination slot. */
export function V1WorkspaceRouteComposition(): React.JSX.Element {
  const route = useV1WorkspaceRouteModel();
  const windowLayout = useWindowLayout();
  const insets = useSafeAreaInsets();
  const runtime = useWorkspaceRuntime();
  const connections = useConnectionProjection(runtime.connectionProfiles, runtime.connectionState);
  const pendingRequests = usePendingRequests(runtime.pendingRequests);
  const threadListSources: ThreadListSources = {
    accountRateLimitsDatabase: runtime.accountRateLimits,
    pendingRequests,
    threadSummaryDatabase: runtime.threadSummaries,
  };
  const list = useWorkspaceListBindings({
    connections,
    desktop: windowLayout.desktop,
    runtime,
    threadListSources,
    threadRouter: route.threadRouter,
  });
  const project = useWorkspaceProjectBindings({
    connections,
    list,
    runtime,
    searchActive: route.pathname === "/v1/search",
  });
  const browserFeedback = useBrowserFeedbackSubmission(
    connections,
    list.scopedThreads,
    list.servers,
    v1WorkspaceCapabilities.browserFeedback,
  );
  const { refreshThreadListAccountRateLimits } = useThreadListAccountRefresh(
    list.servers,
    list.serverScope,
    v1WorkspaceCapabilities.refreshAccountRateLimits,
  );
  const openNewThread = useEvent((connectionId: string, cwd: string | null): void => {
    list.selectServer({ connectionId, kind: "connection" });
    newThreadService.open(connectionId, cwd);
    ensureV1NewThreadRoute(route.router, route.pathname);
  });
  const createSidebarThread = (): void => {
    if (list.projectSelection.sidebarProject !== null) {
      openNewThread(
        list.projectSelection.sidebarProject.connectionId,
        list.projectSelection.sidebarProject.path,
      );
      return;
    }
    const destination = resolveNewThreadRoute({
      serverIds: list.servers.map((server) => server.id),
      serverScope: list.serverScope,
    });
    if (destination.type === "connect-server") {
      route.router.push("/v1/settings/servers/new");
      return;
    }
    if (destination.type === "choose-server") {
      route.router.push("/v1/new");
      return;
    }
    openNewThread(
      destination.serverId,
      project.projectWorkspace.defaultProjectCwd(destination.serverId),
    );
  };
  const openGlobalSearch = (): void => {
    const session = searchRouteSessions.open(workspaceRouteSessionOwner);
    route.router.push({ params: { sessionId: session.id }, pathname: "/v1/search" });
  };
  const openBrowser = useEvent((title: string, url: string): void => {
    const session = browserRouteSessions.open(workspaceRouteSessionOwner, title, url);
    route.router.push({
      params: { sessionId: session.id },
      pathname: "/v1/browser/[sessionId]",
    });
  });
  const openPairingRoute = useEvent((initialCode: string): void => {
    const session = pairingRouteSessions.open(initialCode);
    route.router.push({
      params: { sessionId: session.id },
      pathname: "/v1/settings/servers/new",
    });
  });
  useV1WorkspaceDeepLinks(openPairingRoute, list.selectThread);
  const openAddedConnection = useEvent((added: { readonly id: string }): void => {
    openNewThread(added.id, project.projectWorkspace.defaultProjectCwd(added.id));
  });
  const connectionActions = useConnectionActions(
    v1WorkspaceCapabilities.connection,
    list.settingsConnections,
    openAddedConnection,
  );
  const recovery = useRenderRecovery({
    actions: v1WorkspaceCapabilities.recovery,
    currentThread: route.currentThread,
    fallbackConnectionId:
      list.serverScope.kind === "connection" ? list.serverScope.connectionId : null,
    loadedThreadSummaries: list.loadedThreadSummaries,
    setActiveThreadId: list.selectThread,
  });
  const listActions = useThreadListActions(
    v1WorkspaceCapabilities.threadListActions,
    list.selectedThreadKey,
    list.selectThread,
  );
  const resources: WorkspaceRouteResources = {
    browserFeedback,
    connectionActions,
    connections,
    desktop: windowLayout.desktop,
    insets,
    list,
    listActions,
    openBrowser,
    openNewThread,
    pendingRequests,
    project,
    recovery,
    runtime,
    threadListSources,
    viewportWidth: windowLayout.width,
  };

  const threadList = (
    <V1WorkspaceThreadList
      createSidebarThread={createSidebarThread}
      desktop={windowLayout.desktop}
      list={list}
      listActions={listActions}
      openGlobalSearch={openGlobalSearch}
      openProjects={() => {
        route.router.push("/v1/projects");
      }}
      openSettings={() => {
        route.router.push("/v1/settings");
      }}
      project={project}
      refreshThreadListAccountRateLimits={refreshThreadListAccountRateLimits}
      threadListSources={threadListSources}
      viewportWidth={windowLayout.width}
    />
  );
  return (
    <V1WorkspaceShell pathname={route.pathname} resources={resources}>
      {threadList}
    </V1WorkspaceShell>
  );
}
