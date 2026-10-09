import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { recoverUnavailableRoute } from "../../../src/components/navigation/routeRecovery";
import { workspaceRuntime } from "../../../src/data/workspace-runtime";
import { workspaceFeatures as features } from "../../../src/features/workspace/createWorkspaceFeatures";
import { ALL_SERVER_SCOPE } from "../../../src/services/servers/serverScope";
import { useProjectWorkspace } from "../../../src/features/projects/projectWorkspace";
import { SidebarProjectsSheet } from "../../../src/features/projects/SidebarProjectViews";
import { useWorkspaceRouteResources } from "../../../src/services/workspace/workspaceRouteResources";

/** Composes project management while each directory browser has its own route. */
export default function V1ProjectsRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const resources = useWorkspaceRouteResources();
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  const project = useProjectWorkspace(
    {
      addProject: features.projects.addProject,
      connections: resources.connections,
      listProjects: features.projects.listProjects,
      native: workspaceRuntime.native && visible,
      setProjectPinned: features.projects.setProjectPinned,
      threadSummaryDatabase: resources.runtime.threadSummaries,
    },
    resources.list.servers,
    ALL_SERVER_SCOPE,
    false,
  );
  return (
    <SidebarProjectsSheet
      errors={project.sidebarProjectErrors}
      initialConnectionId={
        resources.list.servers.find((server) => server.id === connectionId)?.id ?? null
      }
      onBrowse={(connectionId) => {
        if (connectionId === null) {
          router.push("/projects/add");
        } else {
          router.push({ params: { connectionId }, pathname: "/projects/add/[connectionId]" });
        }
      }}
      onClose={() => {
        recoverUnavailableRoute(router, "/");
      }}
      onMove={project.moveSidebarProject}
      onToggle={project.toggleSidebarProject}
      projects={project.availableSidebarProjects}
      servers={project.sidebarServers}
      visible={visible}
    />
  );
}
