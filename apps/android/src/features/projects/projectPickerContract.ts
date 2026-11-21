import type { ServerIconId } from "../../data/serverIcons";
import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";

/** Project choices and selection actions exposed to the project picker. */
export type ProjectPickerProps = {
  browseOnly?: boolean;
  busy: boolean;
  connection?: { readonly iconId?: ServerIconId; readonly id: string; readonly name: string };
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

/** A working directory always belongs to one saved server. Null uses that server's default. */
export type ProjectDestination = {
  readonly connectionId: string;
  readonly cwd: string | null;
};

/** Server display and folder availability consumed by the picker without transport ownership. */
export type ProjectPickerServer = {
  readonly available: boolean;
  readonly iconId: ServerIconId;
  readonly id: string;
  readonly name: string;
};

/** Qualified catalog entry; identical paths on different servers remain distinct. */
export type ProjectPickerChoice = {
  readonly project: RemoteProject;
  readonly server: ProjectPickerServer;
};

/** A directory offered for an explicit choice, with the reason its row shows. */
type ProjectSuggestion = {
  readonly destination: { readonly connectionId: string; readonly cwd: string };
  readonly reason: string;
};

/**
 * Explicit-choice mode: a row selects instead of committing, the footer action commits the
 * selection, suggestions lead the list and no server default is offered. `current` is the
 * initial selection; without one the action stays disabled until the user chooses. A folder
 * chosen through Use this folder commits at once.
 */
export type ProjectPickerConfirmation = {
  readonly actionLabel: string;
  readonly suggestions: readonly ProjectSuggestion[];
};

/** Internal selection contract shared by single-server and aggregate picker entrypoints. */
export type ScopedProjectPickerProps = {
  readonly browseOnly?: boolean;
  readonly busy: boolean;
  readonly choices: readonly ProjectPickerChoice[];
  readonly confirmation?: ProjectPickerConfirmation;
  readonly current: ProjectDestination | null;
  readonly error: string | null;
  readonly initialConnectionId: string | null;
  readonly onAddProject?: (connectionId: string, path: string) => Promise<RemoteProject>;
  readonly onClose: () => void;
  readonly onManageProjects?: (connectionId: string | null) => void;
  readonly onReadDirectory?: (
    connectionId: string,
    path: string,
  ) => Promise<RemoteDirectoryEntry[]>;
  readonly onReadHomeDirectory?: (connectionId: string) => Promise<string>;
  readonly onSelect: (destination: ProjectDestination) => Promise<void>;
  readonly servers: readonly ProjectPickerServer[];
  readonly visible: boolean;
};
