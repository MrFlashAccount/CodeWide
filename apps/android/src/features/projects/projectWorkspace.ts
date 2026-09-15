import { useEvent } from "../../react/useEvent";
import { useSelector } from "@legendapp/state/react";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { RemoteProject } from "../../data/remote-projects";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import { orderSidebarProjects } from "./sidebarProjectOrder";
import { sidebarProjects, type SidebarProject } from "./sidebarProjects";
import { useRemoteProjectCatalog } from "./useRemoteProjectCatalog";
import { useSidebarProjectOrder } from "./useSidebarProjectOrder";
/** Existing project reads and mutations with the catalog's unread projection. */
export type ProjectWorkspaceCapability = {
  readonly native: boolean;
  readonly connections: StoredConnection[];
  readonly threadSummaryDatabase: ThreadSummaryDatabase | null;
  listProjects(connectionId: string): Promise<RemoteProject[]>;
  addProject(connectionId: string, path: string): Promise<RemoteProject>;
  setProjectPinned(
    connectionId: string,
    path: string,
    name: string,
    pinned: boolean,
  ): Promise<RemoteProject>;
};
/** Catalog selection and mutations preserve shared catalog/order resources. */
export function useProjectWorkspace(
  remote: ProjectWorkspaceCapability,
  servers: ThreadListServer[],
  activeServerId: string,
  newThreadVisible: boolean,
  searchVisible: boolean,
) {
  const projectOrder = useSidebarProjectOrder();

  const projectCatalogConnections =
    newThreadVisible || searchVisible || activeServerId === ALL_SERVERS_ID
      ? remote.connections
      : remote.connections.filter((connection) => connection.id === activeServerId);

  const projectCatalog = useRemoteProjectCatalog(
    remote.native,
    projectCatalogConnections,
    remote.listProjects,
  );

  const projectsByConnection = projectCatalog.projectsByConnection;

  const projectErrorsByConnection = projectCatalog.errorsByConnection;

  const unreadProjectKeys = useSelector(
    () => remote.threadSummaryDatabase?.projectUnread.projects$.get() ?? [],
  );

  const sidebarServers = servers.filter(
    (server) => activeServerId === ALL_SERVERS_ID || server.id === activeServerId,
  );

  const availableSidebarProjects = orderSidebarProjects(
    sidebarProjects(projectsByConnection, sidebarServers, unreadProjectKeys),
    projectOrder.order,
  );

  const pinnedSidebarProjects = availableSidebarProjects.filter((project) => project.pinned);

  const searchProjects = searchVisible
    ? orderSidebarProjects(
        sidebarProjects(projectsByConnection, servers, []),
        projectOrder.order,
      ).map((project) => ({
        id: project.key,
        serverId: project.connectionId,
        path: project.path,
        name: project.name,
        subtitle: project.subtitle,
        pinned: project.pinned,
      }))
    : [];

  const sidebarProjectErrors = sidebarServers.flatMap((server) => {
    const error = projectErrorsByConnection[server.id];
    return error == null ? [] : [`${server.name}: ${error}`];
  });

  const toggleSidebarProject = useEvent(async (project: SidebarProject) => {
    const updated = await remote.setProjectPinned(
      project.connectionId,
      project.path,
      project.name,
      !project.pinned,
    );
    projectCatalog.mergeProject(project.connectionId, updated);
  });

  const moveSidebarProject = useEvent(async (project: SidebarProject, direction: -1 | 1) => {
    await projectOrder.move(
      pinnedSidebarProjects.map((entry) => entry.key),
      project.key,
      direction,
    );
  });

  const addSidebarProject = useEvent(async (connectionId: string, path: string) => {
    const project = await remote.addProject(connectionId, path);
    projectCatalog.mergeProject(connectionId, project);
    return project;
  });

  const defaultProjectCwd = useEvent(
    (serverId: string): string | null => projectsByConnection[serverId]?.[0]?.path ?? null,
  );
  return {
    projectsByConnection,
    sidebarServers,
    availableSidebarProjects,
    pinnedSidebarProjects,
    searchProjects,
    sidebarProjectErrors,
    toggleSidebarProject,
    moveSidebarProject,
    addSidebarProject,
    defaultProjectCwd,
  };
}
