import { useSelector } from "@legendapp/state/react";
import { createElement, useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RouteUnavailable } from "../components/navigation/RouteUnavailable";
import {
  closeInteractiveTerminalSession,
  focusInteractiveTerminalSession,
} from "../data/interactive-terminal-store";
import { refreshNativeTerminalInventory } from "../data/nativeTerminalInventory";
import { workspaceRuntime, type WorkspaceRuntimeSnapshot } from "../data/workspace-runtime";
import { useThreadListAccountRefresh } from "../features/accounts/threadListAccountRefresh";
import { useConnectionActions } from "../features/connections/connectionActions";
import { useConnectionProjection } from "../features/connections/connectionProjection";
import { useRenderRecovery } from "../features/diagnostics/renderRecovery";
import { globalSupervisorToggleState } from "../features/globalSupervisor/globalSupervisorToggle";
import { globalVoiceOrbStateForPhase } from "../features/globalSupervisor/globalVoiceOrbState";
import { useBrowserFeedbackSubmission } from "../features/browser/feedbackSubmission";
import { resolveNewThreadRoute } from "../features/projects/newThreadRouting";
import { usePendingRequests } from "../features/requests/pendingRequests";
import { GlobalSearchScreen } from "../features/search/GlobalSearchScreen";
import { ManageTerminalsSheet } from "../features/terminal/ManageTerminalsSheet";
import { useThreadListActions } from "../features/threadList/threadListActions";
import type { ThreadListSources } from "../features/threadList/threadListSources";
import { useV1WorkspaceDeepLinks } from "../features/workspace/useV1WorkspaceDeepLinks";
import { useWindowLayout } from "../features/workspace/useWindowLayout";
import { useWorkspaceListBindings } from "../features/workspace/workspaceListBindings";
import { useWorkspaceProjectBindings } from "../features/workspace/workspaceProjectBindings";
import { useWorkspaceRuntime } from "../features/workspace/useWorkspaceRuntime";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import {
  ensureGlobalVoiceOverlayPermission,
  stageGlobalVoiceOrbLaunchOrigin,
  type GlobalVoiceOrbLaunchOrigin,
} from "../native/globalVoiceOverlayPermission";
import type { NativeTerminalSession } from "../native/native-transport";
import { browserRouteSessions } from "../services/browser/browserRouteSession";
import { pairingRouteSessions } from "../services/connections/pairingRouteSession";
import { searchRouteSessions } from "../services/search/searchRouteSession";
import type { ServerScope } from "../services/servers/serverScope";
import { terminalRouteSessions } from "../services/terminal/terminalRouteSession";
import { newThreadService } from "../services/threads/newThreadService";
import { useWorkspaceProjectNavigation } from "./workspaceProjectNavigation";
import type { SidebarProject } from "../features/projects/sidebarProjects";
import {
  v1ThreadDestination,
  v1ThreadRouteParams,
  threadRouteSessionOwner,
  workspaceRouteSessionOwner,
} from "../services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../services/useRouteSessionLifetime";
import type { WorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { useEvent } from "../react/useEvent";
import { useAppNotice } from "../ui/useAppNotice";
import type { AppVoiceInputRuntime } from "../ui/VoiceInputRuntime";
import { WorkspaceListRouteShell } from "./WorkspaceListRoute";
import { ensureV1NewThreadRoute, useWorkspaceRouteModel } from "./WorkspaceRouteModel";
import { workspaceCapabilities } from "./workspaceCapabilities";

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
      variant: "error",
    });
  }, [render, showNotice]);
  const showUnavailable = useEvent((): void => {
    const snapshot = features.globalSupervisor.render$.peek();
    if (snapshot.phase === "unbound") {
      showNotice({ label: "Global Voice Mode needs a home server.", variant: "warning" });
    }
  });
  const toggle = useEvent(async (): Promise<void> => {
    if (state === "idle") {
      const overlayPermission = await ensureGlobalVoiceOverlayPermission();
      if (overlayPermission === "requested") {
        showNotice({
          label: "Allow CodeWide to display the Voice Assistant over other apps.",
          variant: "warning",
        });
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

function sidebarSearchContent({
  closeGlobalSearch,
  resources,
  route,
  searchEntry,
  searchVoiceRuntime,
}: {
  readonly closeGlobalSearch: () => void;
  readonly resources: WorkspaceRouteResources;
  readonly route: ReturnType<typeof useWorkspaceRouteModel>;
  readonly searchEntry: ReturnType<typeof searchRouteSessions.get>;
  readonly searchVoiceRuntime: AppVoiceInputRuntime | null;
}): React.JSX.Element | null {
  return route.globalSearchSessionId === null
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
}

/** Composes the mounted V1 route resources, list chrome, and active destination slot. */
export function WorkspaceRouteComposition(): React.JSX.Element {
  const [terminalsVisible, setTerminalsVisible] = useState(false);
  const windowLayout = useWindowLayout();
  const route = useWorkspaceRouteModel();
  const projectSelection = useWorkspaceProjectNavigation(route.projectListSessionId);
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
    projectSelection,
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
    workspaceCapabilities.browserFeedback,
  );
  const { refreshThreadListAccountRateLimits } = useThreadListAccountRefresh(
    list.servers,
    list.serverScope,
    workspaceCapabilities.refreshAccountRateLimits,
  );
  const openNewThread = useEvent((connectionId: string, cwd: string | null): void => {
    list.selectServer({ connectionId, kind: "connection" });
    newThreadService.open(connectionId, cwd);
    ensureV1NewThreadRoute(route.router, route.pathname, route.projectListSessionId);
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
      route.router.push("/settings/servers/new");
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
    route.router.push({
      params: {
        globalSearchSessionId: session.id,
        ...(route.projectListSessionId === null
          ? {}
          : { projectListSessionId: route.projectListSessionId }),
        ...(route.currentThread === null
          ? {}
          : {
              connectionId: route.currentThread.connectionId.value,
              threadId: route.currentThread.threadId.value,
            }),
      },
      pathname: "/search",
    });
  });
  const openSidebarProject = useEvent((selectedProject: SidebarProject): void => {
    list.listState.setMobileThreadQuery("");
    list.projectListState.setProjectListMode("active");
    projectSelection.openSidebarProject(selectedProject);
  });
  const closeGlobalSearch = useEvent((): void => {
    if (route.globalSearchSessionId !== null) {
      searchRouteSessions.close(route.globalSearchSessionId);
    }
    if (route.currentThread !== null && route.pathname.startsWith("/threads/")) {
      const threadDestination = v1ThreadDestination(route.currentThread);
      const destination = {
        ...threadDestination,
        params: {
          ...threadDestination.params,
          ...(route.projectListSessionId === null
            ? {}
            : { projectListSessionId: route.projectListSessionId }),
        },
      };
      // Explicitly closing Search removes its history entry but keeps the selected result.
      route.router.dismissTo("/search");
      route.router.replace(destination);
      return;
    }
    if (route.router.canGoBack()) {
      route.router.back();
      return;
    }
    route.router.replace(
      route.currentThread === null ? "/" : v1ThreadDestination(route.currentThread),
    );
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
      pathname: "/threads/[connectionId]/[threadId]/terminal",
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
        pathname: "/browser/[sessionId]",
      });
    },
  );
  const openPairingRoute = useEvent((initialCode: string): void => {
    const session = pairingRouteSessions.open(initialCode);
    route.router.push({
      params: { sessionId: session.id },
      pathname: "/settings/servers/new",
    });
  });
  useV1WorkspaceDeepLinks(openPairingRoute, list.selectThread);
  const openAddedConnection = useEvent((added: { readonly id: string }): void => {
    openNewThread(added.id, project.projectWorkspace.defaultProjectCwd(added.id));
  });
  const connectionActions = useConnectionActions(
    workspaceCapabilities.connection,
    list.settingsConnections,
    openAddedConnection,
  );
  const recovery = useRenderRecovery({
    actions: workspaceCapabilities.recovery,
    currentThread: route.currentThread,
    fallbackConnectionId:
      list.serverScope.kind === "connection" ? list.serverScope.connectionId : null,
    loadedThreadSummaries: list.loadedThreadSummaries,
    setActiveThreadId: list.selectThread,
  });
  const listActions = useThreadListActions(
    workspaceCapabilities.threadListActions,
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
  const sidebarSearch = sidebarSearchContent({
    closeGlobalSearch,
    resources,
    route,
    searchEntry,
    searchVoiceRuntime,
  });

  const threadListProps = {
    createSidebarThread,
    desktop: windowLayout.desktop,
    globalVoice,
    list,
    listActions,
    openGlobalSearch,
    openProjects: () => {
      route.router.push("/projects");
    },
    openSettings: () => {
      route.router.push("/settings");
    },
    openSidebarProject,
    openTerminals,
    project,
    refreshThreadListAccountRateLimits,
    sidebarSearch,
    threadListSources,
    viewportWidth: windowLayout.width,
  };
  return (
    <>
      <WorkspaceListRouteShell listProps={threadListProps} resources={resources} />
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
