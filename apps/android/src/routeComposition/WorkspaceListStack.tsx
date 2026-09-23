import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import {
  ThreadListHeader,
  ThreadListSearchPullProvider,
} from "../features/threadList/ThreadListFeature";
import { effectiveThreadListFilter } from "../features/threadList/threadListFilters";
import { NoServerWelcome } from "../features/threadList/NoServerWelcome";
import { useEvent } from "../react/useEvent";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
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
      <View
        accessibilityElementsHidden={searchVisible}
        importantForAccessibility={searchVisible ? "no-hide-descendants" : "auto"}
        pointerEvents={searchVisible ? "none" : "auto"}
        style={styles.flex}
      >
        <CatalogContent />
      </View>
      {searchVisible ? <View style={StyleSheet.absoluteFill}>{sidebarSearch}</View> : null}
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
      <WorkspaceListHeader />
      <View style={styles.listScenes} testID="workspace-list-scenes">
        <ListContentNavigator />
      </View>
    </ThreadListSearchPullProvider>
  );
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

function WorkspaceListHeader(): React.JSX.Element | null {
  const resources = useWorkspaceListRouteResources();
  const { list } = resources;
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
  const closeProject = useEvent((): void => {
    list.projectSelection.closeSidebarProject();
  });
  return (
    <ThreadListHeader
      props={{
        filter: effectiveThreadListFilter(selection.mode, selection.filter),
        globalVoice: resources.globalVoice,
        mode: selection.mode,
        onBackToProjects: closeProject,
        onFilterChange: selection.onFilterChange,
        onManageProjects: resources.openProjects,
        onManageTerminals: resources.openTerminals,
        onModeChange: selection.onModeChange,
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
