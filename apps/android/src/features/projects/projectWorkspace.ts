import { useEvent } from "../../react/useEvent";
import { useSelector } from "@legendapp/state/react";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { RemoteProject } from "../../data/remote-projects";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import { serverScopeIncludes, type ServerScope } from "../../services/servers/serverScope";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { orderSidebarProjects } from "./sidebarProjectOrder";
import { sidebarProjects, type SidebarProject } from "./sidebarProjects";
import { useRemoteProjectCatalog } from "./useRemoteProjectCatalog";
import { useSidebarProjectOrder } from "./useSidebarProjectOrder";
/** Existing project reads and mutations with the catalog's unread projection. */
export type ProjectWorkspaceCapability = {
  addProject: (connectionId: string, path: string) => Promise<RemoteProject>;
  readonly connections: StoredConnection[];
  listProjects: (connectionId: string) => Promise<RemoteProject[]>;
  readonly native: boolean;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  setProjectPinned: (
    connectionId: string,
    path: string,
    name: string,
    pinned: boolean,
  ) => Promise<RemoteProject>;
  readonly threadSummaryDatabase: ThreadSummaryDatabase | null;
};
/** Catalog selection and mutations preserve shared catalog/order resources. */
// WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
// oxlint-disable-next-line eslint/max-params
export function useProjectWorkspace(
  remote: ProjectWorkspaceCapability,
  servers: ThreadListServer[],
  serverScope: ServerScope,
  searchVisible: boolean,
) {
  const projectOrder = useSidebarProjectOrder();

  const projectCatalogConnections =
    searchVisible || serverScope.kind === "all"
      ? remote.connections
      : remote.connections.filter((connection) => serverScopeIncludes(serverScope, connection.id));

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

  const sidebarServers = servers.filter((server) => serverScopeIncludes(serverScope, server.id));

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
        name: project.name,
        path: project.path,
        pinned: project.pinned,
        serverId: project.connectionId,
        subtitle: project.subtitle,
      }))
    : [];

  const sidebarProjectErrors = sidebarServers.flatMap((server) => {
    const error = projectErrorsByConnection[server.id];
    return error === null || error === undefined ? [] : [`${server.name}: ${error}`];
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
    addSidebarProject,
    availableSidebarProjects,
    defaultProjectCwd,
    moveSidebarProject,
    pinnedSidebarProjects,
    projectsByConnection,
    searchProjects,
    sidebarProjectErrors,
    sidebarServers,
    toggleSidebarProject,
  };
}
