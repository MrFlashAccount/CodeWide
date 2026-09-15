import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { CreatedWorkspace, WorkspaceSupport } from "../../data/workspace-creation";
/** Qualified projects operations; transport and persisted state stay with their existing lower owners. */
export type ProjectsWorkspaceCapabilities = {
  listProjects(connectionId: string): Promise<RemoteProject[]>;
  addProject(connectionId: string, path: string): Promise<RemoteProject>;
  setProjectPinned(
    connectionId: string,
    path: string,
    name: string,
    pinned: boolean,
  ): Promise<RemoteProject>;
  readDirectory(connectionId: string, path: string): Promise<RemoteDirectoryEntry[]>;
  readProjectHome(connectionId: string): Promise<string>;
  inspectWorkspace(connectionId: string, workspace: string): Promise<WorkspaceSupport | null>;
  createWorkspace(
    connectionId: string,
    workspace: string,
    requestId: string,
  ): Promise<CreatedWorkspace>;
  startThreadInWorkspace(
    connectionId: string,
    workspace: string,
    requestId: string,
  ): Promise<string>;
  startThread(connectionId: string, cwd?: string): Promise<string>;
};
