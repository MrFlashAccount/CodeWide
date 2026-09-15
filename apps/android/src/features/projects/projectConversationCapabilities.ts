import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "../../data/workspace-creation";
/** Qualified capabilities consumed by the projects owner in conversation composition. */
export type ProjectConversationCapabilities = {
  projects: readonly RemoteProject[];
  discoveredProjects: readonly RemoteProject[];
  projectLoadError: string | null;
  onChangeProject: ((cwd: string | null) => Promise<void>) | undefined;
  workspaceSupport: WorkspaceSupport | null;
  workspaceMode: NewChatWorkspaceMode;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  onAddProject: ((path: string) => Promise<RemoteProject>) | undefined;
  onReadDirectory: ((path: string) => Promise<RemoteDirectoryEntry[]>) | undefined;
  onManageProjects: (() => void) | undefined;
};
