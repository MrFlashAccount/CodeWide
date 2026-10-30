import { useQuery } from "@tanstack/react-query";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { forgeQueryRemoteValue } from "../../../data/forgeQueryResource";
import { remoteValue } from "../../../data/forgeRemoteValue";
import type { ForgeResources } from "../../../data/forgeResources";
import type { PullRequestTarget } from "../workspaceCapabilities";
import { showsWholeFile } from "./changesPresentation";

/** Plugin capability that serves whole head files. */
const FILE_CONTENT_CAPABILITY = "forge.fileContent@1";

/**
 * The selected file's whole head content, read during render through the
 * process-owned query when the PR's plugin declares `forge.fileContent@1` and
 * the file has a patch to show inline. `null` while it loads, when it is not
 * text (too large, binary, missing), when the read fails, and for an
 * undeclared plugin, whose read never runs: the diff keeps its patch view.
 */
export function useHeadFileContent({
  file,
  forge,
  providerCapabilities,
  target,
}: {
  readonly file: PullRequestFile | null;
  readonly forge: Pick<ForgeResources, "fileContent">;
  readonly providerCapabilities: readonly string[];
  readonly target: PullRequestTarget;
}): string | null {
  const wanted =
    file !== null && showsWholeFile(file) && providerCapabilities.includes(FILE_CONTENT_CAPABILITY);
  const query = useQuery(
    {
      ...forge.fileContent.options({ ...target, path: file?.path ?? "" }),
      enabled: wanted,
    },
    forge.fileContent.client,
  );
  const content = wanted ? remoteValue(forgeQueryRemoteValue(query)) : null;
  return content?.state === "text" ? content.content : null;
}
