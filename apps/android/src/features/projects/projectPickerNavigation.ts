import { useState } from "react";
import { pathCrumbs } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import type { ScopedProjectPickerProps } from "./projectPickerContract";
import { defaultDirectory } from "./projectDirectorySelection";

type PickerLocation =
  | { readonly kind: "projects" }
  | { readonly kind: "servers" }
  | {
      readonly connectionId: string;
      readonly kind: "directory";
      readonly path: string | null;
    };

type ProjectPickerNavigation = {
  readonly folderConnectionId: string | null;
  readonly mode: PickerLocation["kind"];
  readonly navigate: (path: string | null) => void;
  readonly navigationDirection: "back" | "forward" | null;
  readonly openDirectoryPicker: (connectionId: string | null) => void;
  readonly requestedDirectory: string | null;
  readonly showProjects: () => void;
  readonly showServers: () => void;
};

function directoryLocation(props: ScopedProjectPickerProps, connectionId: string): PickerLocation {
  return {
    connectionId,
    kind: "directory",
    path:
      props.onReadHomeDirectory === undefined
        ? (pathCrumbs(defaultDirectory(props.current, connectionId))[0]?.path ?? "/")
        : null,
  };
}

function initialLocation(props: ScopedProjectPickerProps): PickerLocation {
  if (props.browseOnly !== true) {
    return { kind: "projects" };
  }
  const initial = props.servers.find((server) => server.id === props.initialConnectionId);
  return initial === undefined ? { kind: "servers" } : directoryLocation(props, initial.id);
}

/** One location owns the active page, concrete server and path without an implicit All destination. */
export function useProjectPickerNavigation(
  props: ScopedProjectPickerProps,
  blocked: boolean,
): ProjectPickerNavigation {
  const [location, setLocation] = useState<PickerLocation>(() => initialLocation(props));
  const [navigationDirection, setNavigationDirection] = useState<"back" | "forward" | null>(null);
  const navigate = useEvent((path: string | null) => {
    if (blocked || location.kind !== "directory") {
      return;
    }
    setLocation({ connectionId: location.connectionId, kind: "directory", path });
  });
  const openDirectoryPicker = useEvent((connectionId: string | null) => {
    if (blocked || props.onReadDirectory === undefined) {
      return;
    }
    if (connectionId === null) {
      setLocation({ kind: "servers" });
    } else if (props.servers.some((server) => server.id === connectionId)) {
      setLocation(directoryLocation(props, connectionId));
    } else {
      return;
    }
    setNavigationDirection("forward");
  });
  const showServers = useEvent(() => {
    if (!blocked) {
      setNavigationDirection("back");
      setLocation({ kind: "servers" });
    }
  });
  const showProjects = useEvent(() => {
    if (!blocked) {
      setNavigationDirection("back");
      setLocation({ kind: "projects" });
    }
  });
  return {
    folderConnectionId: location.kind === "directory" ? location.connectionId : null,
    mode: location.kind,
    navigate,
    navigationDirection,
    openDirectoryPicker,
    requestedDirectory: location.kind === "directory" ? location.path : null,
    showProjects,
    showServers,
  };
}
