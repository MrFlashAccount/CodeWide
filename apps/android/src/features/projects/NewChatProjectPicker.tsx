import { useEvent } from "../../react/useEvent";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ProjectsWorkspaceCapabilities } from "./workspaceCapabilities";
import type {
  ProjectDestination,
  ProjectPickerChoice,
  ProjectPickerServer,
} from "./projectPickerContract";
import { useRemoteProjectCatalog } from "./useRemoteProjectCatalog";
import { projectPickerServers } from "./projectPickerServers";
import { ProjectPickerSurface } from "./ProjectPickerSurface";

function projectChoices(
  pickerServers: readonly ProjectPickerServer[],
  catalog: ReturnType<typeof useRemoteProjectCatalog>,
  error: string | null,
) {
  const choices: ProjectPickerChoice[] = [];
  const errors: string[] = error === null ? [] : [error];
  for (const server of pickerServers) {
    for (const project of catalog.projectsByConnection[server.id] ?? []) {
      choices.push({ project, server });
    }
    const error = catalog.errorsByConnection[server.id];
    if (typeof error === "string" && error !== "") {
      errors.push(`${server.name}: ${error}`);
    }
  }
  return { choices, error: errors.length === 0 ? null : errors.join("\n") };
}

/** Qualified catalog reads and destination actions for creating or editing a local draft. */
export type NewChatProjectPickerProps = {
  readonly busy?: boolean;
  readonly connections: readonly StoredConnection[];
  readonly current: ProjectDestination | null;
  readonly error?: string | null;
  readonly initialConnectionId: string | null;
  readonly native: boolean;
  readonly onClose: () => void;
  readonly onManageProjects: (connectionId: string | null) => void;
  readonly onSelect: (destination: ProjectDestination) => void | Promise<void>;
  readonly remote: Pick<
    ProjectsWorkspaceCapabilities,
    "addProject" | "listProjects" | "readDirectory" | "readProjectHome"
  >;
  readonly servers: readonly ThreadListServer[];
  readonly visible: boolean;
};

/** Draft picker binding; the mounted overlay supplies visibility, dismissal and management navigation. */
export type NewChatProjectPickerBinding = Omit<
  NewChatProjectPickerProps,
  "onClose" | "onManageProjects" | "onSelect" | "visible"
> & { readonly onSelect: (destination: ProjectDestination) => Promise<void> };

/** Reads every server independently of the thread-list filter, then publishes a qualified choice. */
export function NewChatProjectPicker({
  busy = false,
  connections,
  current,
  error = null,
  initialConnectionId,
  native,
  onClose,
  onManageProjects,
  onSelect,
  remote,
  servers,
  visible,
}: NewChatProjectPickerProps): React.JSX.Element {
  const catalog = useRemoteProjectCatalog(native, visible ? connections : [], remote.listProjects);
  const pickerServers = projectPickerServers(servers, connections, native);
  const catalogChoices = projectChoices(pickerServers, catalog, error);
  const addProject = useEvent(async (connectionId: string, path: string) => {
    const project = await remote.addProject(connectionId, path);
    catalog.mergeProject(connectionId, project);
    return project;
  });
  // The route publishes a local draft synchronously; the shared picker consumes an async action.
  const selectProject = useEvent(async (destination: ProjectDestination) => {
    const selection = onSelect(destination);
    if (selection !== undefined) {
      await selection;
    }
  });
  return (
    <ProjectPickerSurface
      busy={busy}
      choices={catalogChoices.choices}
      current={current}
      error={catalogChoices.error}
      initialConnectionId={initialConnectionId}
      onAddProject={addProject}
      onClose={onClose}
      onManageProjects={onManageProjects}
      onReadDirectory={remote.readDirectory}
      onReadHomeDirectory={remote.readProjectHome}
      onSelect={selectProject}
      servers={pickerServers}
      visible={visible}
    />
  );
}
