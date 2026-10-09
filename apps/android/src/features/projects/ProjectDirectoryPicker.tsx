import type { StoredConnection } from "../../data/connection-profile-types";
import { useEvent } from "../../react/useEvent";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ProjectsWorkspaceCapabilities } from "./workspaceCapabilities";
import { ProjectPickerSurface } from "./ProjectPickerSurface";
import { projectPickerServers } from "./projectPickerServers";

/** Adds a folder on an explicitly chosen server without changing the conversation destination. */
export function ProjectDirectoryPicker({
  connections,
  initialConnectionId,
  native,
  onAddProject,
  onClose,
  remote,
  servers,
  visible,
}: {
  readonly connections: readonly StoredConnection[];
  readonly initialConnectionId: string | null;
  readonly native: boolean;
  readonly onAddProject: ProjectsWorkspaceCapabilities["addProject"];
  readonly onClose: () => void;
  readonly remote: Pick<ProjectsWorkspaceCapabilities, "readDirectory" | "readProjectHome">;
  readonly servers: readonly ThreadListServer[];
  readonly visible: boolean;
}): React.JSX.Element {
  // WHY: Selection requires a Promise, but dismissal is synchronous and has no operation to await.
  // oxlint-disable-next-line typescript/promise-function-async
  const finish = useEvent((): Promise<void> => {
    onClose();
    return Promise.resolve();
  });
  return (
    <ProjectPickerSurface
      browseOnly
      busy={false}
      choices={[]}
      current={null}
      error={null}
      initialConnectionId={initialConnectionId}
      onAddProject={onAddProject}
      onClose={onClose}
      onReadDirectory={remote.readDirectory}
      onReadHomeDirectory={remote.readProjectHome}
      onSelect={finish}
      servers={projectPickerServers(servers, connections, native)}
      visible={visible}
    />
  );
}
