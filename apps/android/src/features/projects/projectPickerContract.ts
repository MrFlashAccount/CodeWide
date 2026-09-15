import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";

/** Project choices and selection actions exposed to the project picker. */
export type ProjectPickerProps = {
  visible: boolean;
  cwd: string;
  projects: readonly RemoteProject[];
  discoveredProjects: readonly RemoteProject[];
  busy: boolean;
  error: string | null;
  onSelect(cwd: string | null): Promise<void>;
  onAddProject?(path: string): Promise<RemoteProject>;
  onReadDirectory?(path: string): Promise<RemoteDirectoryEntry[]>;
  onReadHomeDirectory?(): Promise<string>;
  onClose(): void;
  browseOnly?: boolean;
  onManageProjects?(): void;
};
