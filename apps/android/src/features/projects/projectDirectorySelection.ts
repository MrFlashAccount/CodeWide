import type { AsyncResourceSnapshot } from "../../rendering/async-resource-store";
import { normalizeDirectoryPath } from "../../data/remote-projects";
import type { ProjectDestination, ProjectPickerServer } from "./projectPickerContract";

/** Uses an explicit current server directory, falling back to its filesystem root when Home is unsupported. */
export function defaultDirectory(
  current: ProjectDestination | null,
  connectionId: string | null,
): string {
  const path = normalizeDirectoryPath(
    current?.connectionId === connectionId ? (current.cwd ?? "") : "",
  );
  return path === "" ? "/" : path;
}
/** A directory can be submitted only after its qualified listing succeeds. */
export function canAddDirectory({
  adding,
  busy,
  directoryPath,
  directoryServer,
  directoryStatus,
  readError,
}: {
  readonly adding: boolean;
  readonly busy: boolean;
  readonly directoryPath: string;
  readonly directoryServer: ProjectPickerServer | null;
  readonly directoryStatus: AsyncResourceSnapshot<unknown>["status"];
  readonly readError: string | null;
}): boolean {
  return (
    !adding &&
    !busy &&
    directoryServer !== null &&
    directoryServer.available &&
    directoryStatus === "ready" &&
    directoryPath !== "" &&
    readError === null
  );
}
