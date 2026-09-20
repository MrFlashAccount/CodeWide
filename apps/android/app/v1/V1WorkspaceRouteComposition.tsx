import { useSelector } from "@legendapp/state/react";
import { createElement, useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RouteUnavailable } from "../../src/components/navigation/RouteUnavailable";
import {
  closeInteractiveTerminalSession,
  focusInteractiveTerminalSession,
} from "../../src/data/interactive-terminal-store";
import { refreshNativeTerminalInventory } from "../../src/data/nativeTerminalInventory";
import { workspaceRuntime, type WorkspaceRuntimeSnapshot } from "../../src/data/workspace-runtime";
import { useThreadListAccountRefresh } from "../../src/features/accounts/threadListAccountRefresh";
import { useConnectionActions } from "../../src/features/connections/connectionActions";
import { useConnectionProjection } from "../../src/features/connections/connectionProjection";
import { useRenderRecovery } from "../../src/features/diagnostics/renderRecovery";
import { globalSupervisorToggleState } from "../../src/features/globalSupervisor/globalSupervisorToggle";
import { globalVoiceOrbStateForPhase } from "../../src/features/globalSupervisor/globalVoiceOrbState";
import { useBrowserFeedbackSubmission } from "../../src/features/browser/feedbackSubmission";
import { resolveNewThreadRoute } from "../../src/features/projects/newThreadRouting";
import { usePendingRequests } from "../../src/features/requests/pendingRequests";
import { GlobalSearchScreen } from "../../src/features/search/GlobalSearchScreen";
import { ManageTerminalsSheet } from "../../src/features/terminal/ManageTerminalsSheet";
import { useThreadListActions } from "../../src/features/threadList/threadListActions";
import type { ThreadListSources } from "../../src/features/threadList/threadListSources";
import { useV1WorkspaceDeepLinks } from "../../src/features/workspace/useV1WorkspaceDeepLinks";
import { useWindowLayout } from "../../src/features/workspace/useWindowLayout";
import { useWorkspaceListBindings } from "../../src/features/workspace/workspaceListBindings";
import { useWorkspaceProjectBindings } from "../../src/features/workspace/workspaceProjectBindings";
import { useWorkspaceRuntime } from "../../src/features/workspace/useWorkspaceRuntime";
import { workspaceFeatures as features } from "../../src/features/workspace/createWorkspaceFeatures";
import {
  ensureGlobalVoiceOverlayPermission,
  stageGlobalVoiceOrbLaunchOrigin,
  type GlobalVoiceOrbLaunchOrigin,
} from "../../src/native/globalVoiceOverlayPermission";
import type { NativeTerminalSession } from "../../src/native/native-transport";
import { browserRouteSessions } from "../../src/services/browser/browserRouteSession";
import { pairingRouteSessions } from "../../src/services/connections/pairingRouteSession";
import { searchRouteSessions } from "../../src/services/search/searchRouteSession";
import type { ServerScope } from "../../src/services/servers/serverScope";
import { terminalRouteSessions } from "../../src/services/terminal/terminalRouteSession";
import { newThreadService } from "../../src/services/threads/newThreadService";
import {
  v1ThreadDestination,
  v1ThreadRouteParams,
  threadRouteSessionOwner,
  workspaceRouteSessionOwner,
} from "../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../src/services/useRouteSessionLifetime";
import type { WorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { useEvent } from "../../src/react/useEvent";
import { useAppNotice } from "../../src/ui/useAppNotice";
import type { AppVoiceInputRuntime } from "../../src/ui/VoiceInputRuntime";
import { V1WorkspaceShell } from "./V1WorkspaceShell";
import { V1WorkspaceThreadList } from "./V1WorkspaceThreadList";
import { ensureV1NewThreadRoute, useV1WorkspaceRouteModel } from "./V1WorkspaceRouteModel";
import { v1WorkspaceCapabilities } from "./v1WorkspaceCapabilities";

const SEARCH_REMOTE = {
  searchMessages: features.search.searchMessages.bind(features.search),
};
const VOICE_FAILURE_NOTICE_DURATION_MS = 3000;

function resolveSearchVoiceConnectionId(
  serverScope: ServerScope,
  servers: readonly { readonly id: string }[],
): string | null {
  return serverScope.kind === "connection" ? serverScope.connectionId : (servers[0]?.id ?? null);
}

function createSearchVoiceRuntime({
  connectionId,
  resources,
  searchEntry,
  startRemote,
}: {
  readonly connectionId: string | null;
  readonly resources: WorkspaceRuntimeSnapshot["resources"];
  readonly searchEntry: { readonly id: string } | null;
  readonly startRemote: NonNullable<AppVoiceInputRuntime["startRemote"]>;
}): AppVoiceInputRuntime | null {
  if (workspaceRuntime.voiceController === null || resources === null) {
    return null;
  }
  const runtime: AppVoiceInputRuntime = {
    controller: workspaceRuntime.voiceController,
    resources,
    scopePrefix: `search\u0000${searchEntry?.id ?? "inactive"}`,
    thread: null,
  };
  if (!workspaceRuntime.native || connectionId === null) {
    return runtime;
  }
  return { ...runtime, startRemote };
}

function useGlobalVoiceControl() {
  const showNotice = useAppNotice().show;
  const render = useSelector(() => features.globalSupervisor.render$.get());
  const state = globalSupervisorToggleState(render);
  const orbState = globalVoiceOrbStateForPhase(render.phase);
  useEffect(() => {
    if (render.phase !== "failed") {
      return;
    }
    showNotice({
      duration: VOICE_FAILURE_NOTICE_DURATION_MS,
      label: render.failureSummary,
    });
  }, [render, showNotice]);
  const showUnavailable = useEvent((): void => {
    const snapshot = features.globalSupervisor.render$.peek();
    if (snapshot.phase === "unbound") {
      showNotice({ label: "Global Voice Mode needs a home server." });
    }
  });
  const toggle = useEvent(async (): Promise<void> => {
    if (state === "idle") {
      const overlayPermission = await ensureGlobalVoiceOverlayPermission();
      if (overlayPermission === "requested") {
        showNotice({ label: "Allow CodeWide to display the Voice Assistant over other apps." });
        return;
      }
    }
    await features.globalSupervisor.toggle();
    showUnavailable();
  });
  const onToggle = useEvent((origin: GlobalVoiceOrbLaunchOrigin | null): void => {
    if (state === "idle") {
      stageGlobalVoiceOrbLaunchOrigin(origin);
    }
    void toggle().catch(showUnavailable);
  });
  return { onToggle, orbState, state };
}

/** Composes the mounted V1 route resources, list chrome, and active destination slot. */
export function V1WorkspaceRouteComposition(): React.JSX.Element {
  const [terminalsVisible, setTerminalsVisible] = useState(false);
  const windowLayout = useWindowLayout();
  const route = useV1WorkspaceRouteModel(windowLayout.desktop);
  const globalVoice = useGlobalVoiceControl();
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
    threadListSources,
    threadRouter: route.threadRouter,
  });
  const project = useWorkspaceProjectBindings({
    connections,
    list,
    runtime,
    searchActive: route.globalSearchSessionId !== null,
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
      ensureV1NewThreadRoute(route.router, route.pathname);
      return;
    }
    openNewThread(
      destination.serverId,
      project.projectWorkspace.defaultProjectCwd(destination.serverId),
    );
  };
  const openGlobalSearch = useEvent((): void => {
    const session = searchRouteSessions.open(workspaceRouteSessionOwner);
    if (!windowLayout.desktop && route.pathname !== "/v1") {
      route.router.dismissTo("/v1");
    }
    route.router.push({
      params: {
        globalSearchSessionId: session.id,
        ...(route.currentThread === null
          ? {}
          : {
              connectionId: route.currentThread.connectionId.value,
              threadId: route.currentThread.threadId.value,
            }),
      },
      pathname: "/v1/search",
    });
  });
  const closeGlobalSearch = useEvent((): void => {
    if (route.globalSearchSessionId !== null) {
      searchRouteSessions.close(route.globalSearchSessionId);
    }
    if (route.currentThread !== null && route.pathname.startsWith("/v1/threads/")) {
      route.router.replace(v1ThreadDestination(route.currentThread));
      return;
    }
    if (!windowLayout.desktop && route.currentThread !== null && route.pathname === "/v1/search") {
      route.router.replace(v1ThreadDestination(route.currentThread));
      return;
    }
    if (route.router.canGoBack()) {
      route.router.back();
      return;
    }
    route.router.replace("/v1");
  });
  const openTerminals = useEvent((): void => {
    setTerminalsVisible(true);
    void refreshNativeTerminalInventory().catch(() => undefined);
  });
  const closeTerminals = useEvent((): void => {
    setTerminalsVisible(false);
  });
  const selectTerminal = useEvent((terminal: NativeTerminalSession): void => {
    const params = v1ThreadRouteParams({
      connectionId: terminal.connectionId,
      threadId: terminal.threadId,
    });
    if (params.status === "invalid") {
      return;
    }
    focusInteractiveTerminalSession(terminal);
    const session = terminalRouteSessions.open(threadRouteSessionOwner(params.value), {
      connectionId: terminal.connectionId,
      cwd: terminal.cwd,
      threadId: terminal.threadId,
    });
    setTerminalsVisible(false);
    route.router.push({
      params: {
        connectionId: terminal.connectionId,
        sessionId: session.id,
        threadId: terminal.threadId,
      },
      pathname: "/v1/threads/[connectionId]/[threadId]/terminal",
    });
  });
  const closeTerminal = useEvent((sessionId: string): void => {
    closeInteractiveTerminalSession(sessionId);
  });
  const openBrowser = useEvent(
    (title: string, url: string, headers?: Readonly<Record<string, string>>): void => {
      const session = browserRouteSessions.open(workspaceRouteSessionOwner, {
        ...(headers === undefined ? {} : { headers }),
        title,
        url,
      });
      route.router.push({
        params: {
          sessionId: session.id,
          ...(route.currentThread === null
            ? {}
            : {
                connectionId: route.currentThread.connectionId.value,
                threadId: route.currentThread.threadId.value,
              }),
          ...(route.globalSearchSessionId === null
            ? {}
            : { globalSearchSessionId: route.globalSearchSessionId }),
        },
        pathname: "/v1/browser/[sessionId]",
      });
    },
  );
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
  const searchEntry =
    route.globalSearchSessionId === null
      ? null
      : searchRouteSessions.get(route.globalSearchSessionId, workspaceRouteSessionOwner);
  const searchVoiceConnectionId = resolveSearchVoiceConnectionId(list.serverScope, list.servers);
  const startSearchVoiceTranscription = useEvent<NonNullable<AppVoiceInputRuntime["startRemote"]>>(
    async (listener, options) => {
      if (searchVoiceConnectionId === null) {
        throw new Error("Connect a server to use voice input");
      }
      return features.composer.startVoiceTranscription(
        searchVoiceConnectionId,
        "",
        listener,
        options,
      );
    },
  );
  const searchVoiceRuntime = createSearchVoiceRuntime({
    connectionId: searchVoiceConnectionId,
    resources: runtime.resources,
    searchEntry,
    startRemote: startSearchVoiceTranscription,
  });
  useRouteSessionLifetime(
    searchEntry?.id ?? null,
    (entryId) => {
      searchRouteSessions.close(entryId);
    },
    (entryId) => searchRouteSessions.retain(entryId, workspaceRouteSessionOwner),
  );
  const sidebarSearch =
    route.globalSearchSessionId === null
      ? null
      : searchEntry === null
        ? createElement(RouteUnavailable, {
            message: "Open search again to start a new session.",
            onBack: closeGlobalSearch,
            title: "Search expired",
          })
        : createElement(GlobalSearchScreen, {
            onClose: closeGlobalSearch,
            onOpenThread: resources.list.openSearchThread,
            projects: resources.project.projectWorkspace.searchProjects,
            remote: SEARCH_REMOTE,
            servers: resources.list.servers,
            session: searchEntry.session,
            threads: resources.list.scopedThreads,
            voiceRuntime: searchVoiceRuntime,
          });

  const threadList = (
    <V1WorkspaceThreadList
      createSidebarThread={createSidebarThread}
      desktop={windowLayout.desktop}
      globalVoice={globalVoice}
      list={list}
      listActions={listActions}
      openGlobalSearch={openGlobalSearch}
      openProjects={() => {
        route.router.push("/v1/projects");
      }}
      openSettings={() => {
        route.router.push("/v1/settings");
      }}
      openTerminals={openTerminals}
      project={project}
      refreshThreadListAccountRateLimits={refreshThreadListAccountRateLimits}
      sidebarSearch={sidebarSearch}
      threadListSources={threadListSources}
      viewportWidth={windowLayout.width}
    />
  );
  return (
    <>
      <V1WorkspaceShell pathname={route.pathname} resources={resources}>
        {threadList}
      </V1WorkspaceShell>
      <ManageTerminalsSheet
        onClose={closeTerminals}
        onCloseTerminal={closeTerminal}
        onFocusTerminal={selectTerminal}
        servers={list.servers}
        threads={list.scopedThreads}
        visible={terminalsVisible}
      />
    </>
  );
}
