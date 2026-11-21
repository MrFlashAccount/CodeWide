import type { NewChatProjectPickerBinding } from "./NewChatProjectPicker";
import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "../../data/workspace-creation";
/** Qualified capabilities consumed by the projects owner in conversation composition. */
export type ProjectConversationCapabilities = {
  discoveredProjects: readonly RemoteProject[];
  newChatPicker?: NewChatProjectPickerBinding | null;
  onAddProject: ((path: string) => Promise<RemoteProject>) | undefined;
  onChangeProject: ((cwd: string | null) => Promise<void>) | undefined;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  onManageProjects: ((connectionId?: string | null) => void) | undefined;
  onReadDirectory: ((path: string) => Promise<RemoteDirectoryEntry[]>) | undefined;
  projectLoadError: string | null;
  /**
   * `required`: the draft has no server default and nothing can be sent until a project is
   * chosen; `suggesting` while its host is still finding the project to pre-select.
   */
  projectRequirement: "none" | "required" | "suggesting";
  projects: readonly RemoteProject[];
  workspaceMode: NewChatWorkspaceMode;
  workspaceSupport: WorkspaceSupport | null;
};
