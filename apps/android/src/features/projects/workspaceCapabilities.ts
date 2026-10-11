import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { AgentProviderId } from "../../data/threadAgent";
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
  startThread: (connectionId: string, cwd?: string, agent?: ThreadStartAgent) => Promise<string>;
  startThreadInWorkspace: (
    connectionId: string,
    workspace: string,
    start: { readonly agent: ThreadStartAgent | null; readonly requestId: string },
  ) => Promise<string>;
};

/**
 * Model chosen for a new chat and the provider whose catalog row offered it.
 * `thread/start` binds the thread to that provider for its whole life; a
 * `null` provider comes from a legacy catalog and lets the Companion decide.
 */
export type ThreadStartAgent = {
  readonly model: string;
  readonly provider: AgentProviderId | null;
};
