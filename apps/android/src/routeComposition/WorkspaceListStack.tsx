import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { View, type LayoutChangeEvent } from "react-native";

import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import {
  ThreadListFabProvider,
  ThreadListHeader,
  ThreadListSearchPullProvider,
  ThreadListVoiceFab,
} from "../features/threadList/ThreadListFeature";
import { effectiveThreadListFilter } from "../features/threadList/threadListFilters";
import { NoServerWelcome } from "../features/threadList/NoServerWelcome";
import { useEvent } from "../react/useEvent";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { CatalogSearchOverlayHost } from "../presentation/layouts/CatalogSearchOverlayHost";
import { projectListRouteSessions } from "../services/projects/projectListRouteSession";
import { useWorkspaceListRouteResources } from "./workspaceListRouteResources";
import { useWorkspaceRouteModel } from "./WorkspaceRouteModel";
import { isNoServerWorkspace } from "./noServerWorkspace";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import {
  v1ProjectListScreenOptions,
  v1RouteScreenOptions,
  v1WorkspaceShellStyles as styles,
} from "./WorkspaceShell.styles";

/** Owns the fixed catalog chrome above the nested native navigator. */
export function WorkspaceListStack(): React.JSX.Element {
  const { desktop, sidebarSearch } = useWorkspaceListRouteResources();
  const searchVisible = desktop && sidebarSearch !== null;
  useEffect(() => {
    workspaceCatalogDiagnostics.record({
      state: searchVisible ? "search" : "list",
      type: "content",
    });
  }, [searchVisible]);
  useEffect(
    () => () => {
      workspaceCatalogDiagnostics.record({ state: "unmounted", type: "content" });
    },
    [],
  );
  const onLayout = useEvent((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    workspaceCatalogDiagnostics.record({ height, surface: "content", type: "layout", width });
  });
  return (
    <View onLayout={onLayout} style={styles.flex} testID="workspace-list-layout">
      <CatalogSearchOverlayHost overlay={searchVisible ? sidebarSearch : null}>
        <CatalogContent />
      </CatalogSearchOverlayHost>
    </View>
  );
}

function CatalogContent(): React.JSX.Element {
  const { runtime } = useWorkspaceRouteResources();
  const router = useRouter();
  const openPairing = useEvent((): void => {
    router.push("/settings/servers/new");
  });
  if (isNoServerWorkspace(runtime)) {
    return <NoServerWelcome onConnect={openPairing} />;
  }
  return (
    <ThreadListSearchPullProvider>
      <ThreadListFabProvider>
        <CatalogBody />
      </ThreadListFabProvider>
    </ThreadListSearchPullProvider>
  );
}

/** Fixed header, the native list scenes and the catalog's single voice action. */
function CatalogBody(): React.JSX.Element {
  return (
    <>
      <CatalogHeader />
      <View style={styles.listScenes} testID="workspace-list-scenes">
        <ListContentNavigator />
      </View>
      <CatalogVoiceAction />
    </>
  );
}

/** The retained Threads header shared only by All and project destinations. */
function CatalogHeader(): React.JSX.Element | null {
  return <WorkspaceListHeader />;
}

function ListContentNavigator(): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  return (
    <Stack screenOptions={reducedMotion ? v1RouteScreenOptions : v1ProjectListScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="project/[sessionId]" />
    </Stack>
  );
}

/** The focused list scope (All or one project) with its mode and filter selection. */
function useFocusedCatalogScope() {
  const { list } = useWorkspaceListRouteResources();
  const route = useWorkspaceRouteModel();
  const session =
    route.projectListSessionId === null
      ? null
      : projectListRouteSessions.get(route.projectListSessionId);
  const project = session?.project ?? null;
  const projectState = list.projectListState;
  const rootState = list.listState;
  const selection =
    project === null
      ? {
          filter: rootState.threadListFilter,
          mode: rootState.threadListMode,
          onFilterChange: rootState.setThreadListFilter,
          onModeChange: rootState.setThreadListMode,
        }
      : {
          filter: projectState.projectListFilter,
          mode: projectState.projectListMode,
          onFilterChange: projectState.setProjectListFilter,
          onModeChange: projectState.setProjectListMode,
        };
  return { project, selection };
}

/** One Global Voice action above the focused scope's New thread action. */
function CatalogVoiceAction(): React.JSX.Element | null {
  const { globalVoice } = useWorkspaceListRouteResources();
  const { selection } = useFocusedCatalogScope();
  return (
    <ThreadListVoiceFab globalVoice={globalVoice} primaryVisible={selection.mode === "active"} />
  );
}

function WorkspaceListHeader(): React.JSX.Element | null {
  const resources = useWorkspaceListRouteResources();
  const { list } = resources;
  const rootState = list.listState;
  const { project, selection } = useFocusedCatalogScope();
  const closeProject = useEvent((): void => {
    list.projectSelection.closeSidebarProject();
  });
  return (
    <ThreadListHeader
      props={{
        filter: effectiveThreadListFilter(selection.mode, selection.filter),
        mode: selection.mode,
        onBackToProjects: closeProject,
        onFilterChange: selection.onFilterChange,
        onManageProjects: resources.openProjects,
        onManageTerminals: resources.openTerminals,
        onModeChange: selection.onModeChange,
        onOpenDownloads: resources.openDownloads,
        onOpenSearch: resources.openGlobalSearch,
        onQueryChange: rootState.setMobileThreadQuery,
        onRefreshAccountRateLimits: resources.refreshThreadListAccountRateLimits,
        onSelectServer: list.selectServer,
        onSettings: resources.openSettings,
        project,
        remote: resources.threadListSources,
        searchContent: null,
        servers: list.servers,
        serverScope:
          project === null
            ? list.serverScope
            : { connectionId: project.connectionId, kind: "connection" },
      }}
    />
  );
}
