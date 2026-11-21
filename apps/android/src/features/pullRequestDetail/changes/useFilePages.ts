import { useQuery } from "@tanstack/react-query";

import { classifyForgeError } from "../../../data/forgeErrors";
import { appendFiles, remainingFileOptions } from "../../../data/forgeFilePages";
import type { PullRequestFilesPage } from "../../../data/forgeMutationContract";
import { useForgeQuery } from "../../../data/forgeQueryResource";
import { remoteValue } from "../../../data/forgeRemoteValue";
import type { ForgeResources } from "../../../data/forgeResources";
import { useEvent } from "../../../react/useEvent";
import type { PullRequestTarget } from "../workspaceCapabilities";
import { firstPageFailure, type FilesFailure } from "./filesFailure";

type FileDemand = { readonly open: boolean; readonly selectedPath: string | null };

function needsMore(first: PullRequestFilesPage | null, demand: FileDemand): boolean {
  if (first === null || first.nextCursor === null) {
    return false;
  }
  return (
    demand.open ||
    first.files.length === 0 ||
    (demand.selectedPath !== null && !first.files.some((file) => file.path === demand.selectedPath))
  );
}

/** Shows the first diff immediately and loads the remaining files as the picker or guide needs them. */
export function useFilePages(
  files: ForgeResources["files"],
  target: PullRequestTarget,
  demand: FileDemand,
): {
  readonly filesFailure: FilesFailure | null;
  readonly page: PullRequestFilesPage | null;
  readonly treeFailure: FilesFailure | null;
} {
  const firstRead = useForgeQuery(files, target);
  const first = remoteValue(firstRead);
  const tail = useQuery(
    { ...remainingFileOptions(files, target, first), enabled: needsMore(first, demand) },
    files.client,
  );
  const retryFirst = useEvent(() => {
    void files.refresh(target).catch(() => undefined);
  });
  const retryTail = useEvent(() => {
    void tail.refetch().catch(() => undefined);
  });
  return {
    filesFailure: firstPageFailure(firstRead, retryFirst),
    page: first !== null && tail.data !== undefined ? appendFiles(first, tail.data) : first,
    treeFailure:
      tail.error === null
        ? null
        : { message: classifyForgeError(tail.error).message, retry: retryTail },
  };
}
