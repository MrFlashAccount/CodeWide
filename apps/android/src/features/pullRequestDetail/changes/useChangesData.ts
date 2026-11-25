import { useSelector } from "@legendapp/state/react";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import { useForgeQuery } from "../../../data/forgeQueryResource";
import { remoteValue } from "../../../data/forgeRemoteValue";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { useDraftPuts, type DraftPut } from "../../../data/reviewDraftPuts";
import type { PullRequestChangesProps } from "./changesContract";
import type { FilesFailure } from "./filesFailure";
import { useFilePages } from "./useFilePages";
import type { PullRequestTarget } from "../workspaceCapabilities";
import type { HeadFileSource } from "./useFileExpansion";

/** Plugin capability that serves whole head files. */
const FILE_CONTENT_CAPABILITY = "forge.fileContent@1";
const NO_DRAFTS: readonly DraftComment[] = [];

/** Files, drafts, the selected file and the viewed toggle of the Changes tab. */
export type ChangesData = {
  readonly agentTitle: string | null;
  /** New drafts sent but not in the drafts snapshot yet: being saved, or refused. */
  readonly draftPuts: readonly DraftPut[];
  readonly drafts: readonly DraftComment[];
  readonly files: readonly PullRequestFile[];
  /** Why the first files page could not be read; `null` while it loads or once shown. */
  readonly filesFailure: FilesFailure | null;
  /** Where whole head files of the current head are read from. */
  readonly headFiles: HeadFileSource;
  readonly page: PullRequestFilesPage | null;
  readonly selected: PullRequestFile | null;
  readonly source: {
    readonly kind: "pullRequest";
    readonly pullRequest: PullRequestTarget["pullRequest"];
  };
  readonly target: PullRequestTarget;
  /** Failed continuation with the already loaded files still available. */
  readonly treeFailure: FilesFailure | null;
  readonly view: "files" | "guide";
};

/**
 * Demands the files page of the current head and the PR's drafts (both
 * progressive), names where whole head files are read from, and owns the
 * viewed toggle. A failed first files page is reported with a retry instead
 * of an endless loading state. A viewed change
 * is an explicit forge write with its own pending state; a failure keeps the
 * previous mark.
 */
export function useChangesData(props: PullRequestChangesProps, filesOpen: boolean): ChangesData {
  const { connectionId, forge, model, overview, review } = props;
  const target: PullRequestTarget = {
    connectionId,
    headRevision: overview.headRevision,
    pullRequest: overview.pullRequest,
  };
  const source = {
    kind: "pullRequest" as const,
    pullRequest: overview.pullRequest,
  };
  const drafts = useForgeQuery(review.drafts, { connectionId, source });
  const saved = remoteValue(drafts)?.drafts ?? NO_DRAFTS;
  const draftPuts = useDraftPuts(review.drafts.client, { connectionId, source }, saved);
  const view = useSelector(() => model.changesView.get());
  const selectedPath = useSelector(() => model.selectedPath.get());
  const { filesFailure, page, treeFailure } = useFilePages(forge.files, target, {
    open: filesOpen || view === "guide",
    selectedPath,
  });
  const loadedFiles = page?.files ?? [];
  const selected = selectedFile(loadedFiles, selectedPath);

  return {
    agentTitle: props.agentThread?.title ?? null,
    draftPuts,
    drafts: saved,
    files: loadedFiles,
    filesFailure,
    headFiles: {
      capable: props.providerCapabilities.includes(FILE_CONTENT_CAPABILITY),
      resource: forge.fileContent,
      target,
    },
    page,
    selected,
    source,
    target,
    treeFailure,
    view,
  };
}

function selectedFile(
  files: readonly PullRequestFile[],
  path: string | null,
): PullRequestFile | null {
  return files.find((file) => file.path === path) ?? files[0] ?? null;
}
