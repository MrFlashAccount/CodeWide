import { useEvent } from "../../react/useEvent";
import type {
  ProjectDestination,
  ProjectPickerProps,
  ProjectPickerServer,
} from "./projectPickerContract";
import { ProjectPickerSurface } from "./ProjectPickerSurface";

/** Adapts a server-bound conversation or management browser to the shared qualified picker. */
export function ProjectPickerSheet(props: ProjectPickerProps): React.JSX.Element {
  const server: ProjectPickerServer = {
    available: true,
    iconId: props.connection?.iconId ?? "desktop",
    id: props.connection?.id ?? "current",
    name: props.connection?.name ?? "Server",
  };
  const select = useEvent(async (destination: ProjectDestination) =>
    props.onSelect(destination.cwd),
  );
  const add = useEvent(async (_connectionId: string, path: string) => {
    if (props.onAddProject === undefined) {
      throw new Error("Adding projects is unavailable");
    }
    return props.onAddProject(path);
  });
  const read = useEvent(async (_connectionId: string, path: string) => {
    if (props.onReadDirectory === undefined) {
      throw new Error("Folder browsing is unavailable");
    }
    return props.onReadDirectory(path);
  });
  const home = useEvent(async (_connectionId: string) => {
    if (props.onReadHomeDirectory === undefined) {
      throw new Error("Server home is unavailable");
    }
    return props.onReadHomeDirectory();
  });
  return (
    <ProjectPickerSurface
      busy={props.busy}
      choices={[...props.projects, ...props.discoveredProjects].map((project) => ({
        project,
        server,
      }))}
      current={{ connectionId: server.id, cwd: props.cwd }}
      error={props.error}
      initialConnectionId={server.id}
      onClose={props.onClose}
      onSelect={select}
      servers={[server]}
      visible={props.visible}
      {...(props.browseOnly === undefined ? {} : { browseOnly: props.browseOnly })}
      {...(props.onAddProject === undefined ? {} : { onAddProject: add })}
      {...(props.onReadDirectory === undefined ? {} : { onReadDirectory: read })}
      {...(props.onReadHomeDirectory === undefined ? {} : { onReadHomeDirectory: home })}
      {...(props.onManageProjects === undefined
        ? {}
        : { onManageProjects: props.onManageProjects })}
    />
  );
}
