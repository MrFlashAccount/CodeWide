/** The Changes tab's projection of a files page read that never succeeded. */
import type { RemoteValue } from "../../../data/forgeRemoteValue";

/** A first files page that could not be read, with its retry. */
export type FilesFailure = {
  readonly message: string;
  readonly retry: () => void;
};

/**
 * The failure the Changes tab shows instead of its skeleton: only when no
 * files page was ever published, so a failed refresh keeps the shown files.
 */
export function firstPageFailure<Page>(
  files: RemoteValue<Page>,
  retry: () => void,
): FilesFailure | null {
  return files.status === "failed" && files.value === null
    ? { message: files.failure.message, retry }
    : null;
}
