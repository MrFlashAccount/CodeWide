import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";

/** Project choices and selection actions exposed to the project picker. */
export type ProjectPickerProps = {
  browseOnly?: boolean;
  busy: boolean;
  cwd: string;
  discoveredProjects: readonly RemoteProject[];
  error: string | null;
  onAddProject?: (path: string) => Promise<RemoteProject>;
  onClose: () => void;
  onManageProjects?: () => void;
  onReadDirectory?: (path: string) => Promise<RemoteDirectoryEntry[]>;
  onReadHomeDirectory?: () => Promise<string>;
  onSelect: (cwd: string | null) => Promise<void>;
  projects: readonly RemoteProject[];
  visible: boolean;
};
