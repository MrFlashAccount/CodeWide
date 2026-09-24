import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { CreatedWorkspace, WorkspaceSupport } from "../../data/workspace-creation";
/** Qualified projects operations; transport and persisted state stay with their existing lower owners. */
export type ProjectsWorkspaceCapabilities = {
  addProject: (connectionId: string, path: string) => Promise<RemoteProject>;
  createWorkspace: (
    connectionId: string,
    workspace: string,
    requestId: string,
  ) => Promise<CreatedWorkspace>;
  forgetConnection: (connectionId: string) => Promise<void>;
  inspectWorkspace: (connectionId: string, workspace: string) => Promise<WorkspaceSupport | null>;
  listProjects: (connectionId: string) => Promise<RemoteProject[]>;
  readDirectory: (connectionId: string, path: string) => Promise<RemoteDirectoryEntry[]>;
  readProjectHome: (connectionId: string) => Promise<string>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  setProjectPinned: (
    connectionId: string,
    path: string,
    name: string,
    pinned: boolean,
  ) => Promise<RemoteProject>;
  startThread: (connectionId: string, cwd?: string) => Promise<string>;
  startThreadInWorkspace: (
    connectionId: string,
    workspace: string,
    requestId: string,
  ) => Promise<string>;
};
