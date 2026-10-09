import { useAsyncResource, type AsyncResourceSnapshot } from "../../rendering/async-resource-store";
import type { RemoteDirectoryEntry } from "../../data/remote-projects";
import { pathCrumbs } from "../../data/remote-projects";
import type { ScopedProjectPickerProps } from "./projectPickerContract";

type DirectoryResource = {
  readonly directory: AsyncResourceSnapshot<RemoteDirectoryEntry[]>;
  readonly directoryEntries: readonly RemoteDirectoryEntry[];
  readonly directoryLoading: boolean;
  readonly directoryPath: string;
  readonly home: AsyncResourceSnapshot<string>;
  readonly readError: string | null;
};

function resourceKey({
  connectionId,
  enabled,
  kind,
  path,
  pickerId,
}: {
  readonly connectionId: string | null;
  readonly enabled: boolean;
  readonly kind: "directory" | "home";
  readonly path: string;
  readonly pickerId: string;
}): string | null {
  if (!enabled || connectionId === null || path === "") {
    return null;
  }
  return JSON.stringify([pickerId, connectionId, kind, path]);
}
function resourceStatus(
  home: AsyncResourceSnapshot<string>,
  directory: AsyncResourceSnapshot<RemoteDirectoryEntry[]>,
  requestedDirectory: string | null,
) {
  return {
    directoryLoading:
      directory.status === "loading" || (requestedDirectory === null && home.status === "loading"),
    readError: (requestedDirectory === null ? home.error : null) ?? directory.error,
  };
}

/** Captures one server per resource key so delayed reads and retries never use another host. */
export function useProjectDirectoryResource({
  connectionId,
  enabled,
  pickerId,
  props,
  requestedDirectory,
}: {
  readonly connectionId: string | null;
  readonly enabled: boolean;
  readonly pickerId: string;
  readonly props: {
    readonly onReadDirectory: ScopedProjectPickerProps["onReadDirectory"];
    readonly onReadHomeDirectory: ScopedProjectPickerProps["onReadHomeDirectory"];
  };
  readonly requestedDirectory: string | null;
}): DirectoryResource {
  const { onReadDirectory, onReadHomeDirectory } = props;
  const home = useAsyncResource<string>(
    resourceKey({
      connectionId,
      enabled: enabled && onReadHomeDirectory !== undefined,
      kind: "home",
      path: "home",
      pickerId,
    }),
    0,
    async () => {
      if (onReadHomeDirectory === undefined || connectionId === null) {
        throw new Error("Server home directory is unavailable");
      }
      return onReadHomeDirectory(connectionId);
    },
  );
  const directoryPath = requestedDirectory ?? pathCrumbs(home.value ?? "")[0]?.path ?? "";
  const directory = useAsyncResource<RemoteDirectoryEntry[]>(
    resourceKey({
      connectionId,
      enabled: enabled && onReadDirectory !== undefined,
      kind: "directory",
      path: directoryPath,
      pickerId,
    }),
    0,
    async () => {
      if (onReadDirectory === undefined || connectionId === null) {
        throw new Error("Choose a server to browse folders");
      }
      const entries = await onReadDirectory(connectionId, directoryPath);
      return entries
        .filter((entry) => entry.isDirectory)
        .sort((left, right) =>
          left.fileName.localeCompare(right.fileName, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
    },
  );
  return {
    directory,
    directoryEntries: directory.value ?? [],
    directoryPath,
    home,
    ...resourceStatus(home, directory, requestedDirectory),
  };
}
