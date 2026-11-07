import { workspaceRuntime } from "../data/workspace-runtime";
import { ProjectDirectoryPicker } from "../features/projects/ProjectDirectoryPicker";
import { useProjectWorkspace } from "../features/projects/projectWorkspace";
import { SidebarProjectsSheet } from "../features/projects/SidebarProjectViews";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import { ALL_SERVER_SCOPE } from "../services/servers/serverScope";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";

/**
 * Binds Manage Projects to the workspace's project capabilities. The native sheet window presents
 * it over the whole application while `visible`; its presenter (the `/projects` route or a pane's
 * local owner) decides when that is and where Add project and close lead.
 */
export function ProjectManagementSheet({
  initialConnectionId,
  onBrowse,
  onClose,
  visible,
}: {
  /** The server whose projects the sheet filters first; an unknown server shows all. */
  readonly initialConnectionId: string | null;
  readonly onBrowse: (connectionId: string | null) => void;
  readonly onClose: () => void;
  readonly visible: boolean;
}): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
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
        resources.list.servers.find((server) => server.id === initialConnectionId)?.id ?? null
      }
      onBrowse={onBrowse}
      onClose={onClose}
      onMove={project.moveSidebarProject}
      onToggle={project.toggleSidebarProject}
      projects={project.availableSidebarProjects}
      servers={project.sidebarServers}
      visible={visible}
    />
  );
}

/**
 * Binds the Add project folder browser to the workspace's project capabilities. It starts at the
 * server catalogue (`null`) or on the given server, and adds the chosen folder before closing.
 */
export function AddProjectSheet({
  initialConnectionId,
  onClose,
  visible,
}: {
  readonly initialConnectionId: string | null;
  readonly onClose: () => void;
  readonly visible: boolean;
}): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
  return (
    <ProjectDirectoryPicker
      connections={resources.connections}
      initialConnectionId={initialConnectionId}
      native={workspaceRuntime.native}
      onAddProject={resources.project.projectWorkspace.addSidebarProject}
      onClose={onClose}
      remote={{
        readDirectory: features.projects.readDirectory,
        readProjectHome: features.projects.readProjectHome,
      }}
      servers={resources.list.servers}
      visible={visible}
    />
  );
}
