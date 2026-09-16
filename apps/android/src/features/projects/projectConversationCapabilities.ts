import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "../../data/workspace-creation";
/** Qualified capabilities consumed by the projects owner in conversation composition. */
export type ProjectConversationCapabilities = {
  discoveredProjects: readonly RemoteProject[];
  onAddProject: ((path: string) => Promise<RemoteProject>) | undefined;
  onChangeProject: ((cwd: string | null) => Promise<void>) | undefined;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  onManageProjects: (() => void) | undefined;
  onReadDirectory: ((path: string) => Promise<RemoteDirectoryEntry[]>) | undefined;
  projectLoadError: string | null;
  projects: readonly RemoteProject[];
  workspaceMode: NewChatWorkspaceMode;
  workspaceSupport: WorkspaceSupport | null;
};
