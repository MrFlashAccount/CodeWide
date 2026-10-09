import type { ScopedProjectPickerProps } from "./projectPickerContract";

/** Management registers a folder before returning its path; draft selection has no registry side effect. */
export async function directorySelectionPath(
  props: Pick<ScopedProjectPickerProps, "browseOnly" | "onAddProject">,
  connectionId: string,
  path: string,
): Promise<string> {
  if (props.browseOnly !== true) {
    return path;
  }
  if (props.onAddProject === undefined) {
    throw new Error("Adding projects is unavailable");
  }
  return (await props.onAddProject(connectionId, path)).path;
}
