import { useSelector } from "@legendapp/state/react";
import { useState } from "react";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import { useForgeQuery } from "../../../data/forgeQueryResource";
import { remoteValue } from "../../../data/forgeRemoteValue";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { PullRequestChangesProps } from "./changesContract";
import { firstPageFailure, type FilesFailure } from "./filesFailure";
import type { PullRequestTarget } from "../workspaceCapabilities";
import { useHeadFileContent } from "./useHeadFileContent";

/** Files, drafts, the selected file and the viewed toggle of the Changes tab. */
export type ChangesData = {
  readonly drafts: readonly DraftComment[];
  /** Why the first files page could not be read; `null` while it loads or once shown. */
  readonly filesFailure: FilesFailure | null;
  /** The user's file tree choice; `null` follows the form factor. */
  readonly filesPanelOpen: boolean | null;
  /** The selected file's whole head content once read; `null` keeps the patch view. */
  readonly headContent: string | null;
  readonly page: PullRequestFilesPage | null;
  readonly selected: PullRequestFile | null;
  readonly source: {
    readonly kind: "pullRequest";
    readonly pullRequest: PullRequestTarget["pullRequest"];
  };
  readonly target: PullRequestTarget;
  readonly toggleViewed: (file: PullRequestFile) => void;
  readonly view: "files" | "guide";
  readonly viewedPending: ReadonlySet<string>;
};

/**
 * Demands the files page of the current head, the selected file's whole head
 * content and the PR's drafts (all progressive) and owns the viewed toggle. A failed first files page is
 * reported with a retry instead of an endless loading state. A viewed change
 * is an explicit forge write with its own pending state; a failure keeps the
 * previous mark.
 */
export function useChangesData(props: PullRequestChangesProps): ChangesData {
  const { connectionId, forge, model, overview, review } = props;
  const dialog = useAppDialog();
  const target: PullRequestTarget = {
    connectionId,
    headRevision: overview.headRevision,
    pullRequest: overview.pullRequest,
  };
  const source = {
    kind: "pullRequest" as const,
    pullRequest: overview.pullRequest,
  };
  const files = useForgeQuery(forge.files, target);
  const drafts = useForgeQuery(review.drafts, { connectionId, source });
  const view = useSelector(() => model.changesView.get());
  const selectedPath = useSelector(() => model.selectedPath.get());
  const filesPanelOpen = useSelector(() => model.filesPanelOpen.get());
  const [viewedPending, setViewedPending] = useState<ReadonlySet<string>>(new Set());
  const page = remoteValue(files);
  const selected = page?.files.find((file) => file.path === selectedPath) ?? page?.files[0] ?? null;
  const headContent = useHeadFileContent({
    file: selected,
    forge,
    providerCapabilities: props.providerCapabilities,
    target,
  });
  const retryFiles = useEvent((): void => {
    forge.files.refresh(target).catch(() => undefined);
  });
  const toggleViewed = useEvent((file: PullRequestFile): void => {
    setViewedPending((current) => new Set([...current, file.path]));
    props.capabilities
      .setViewed(target, file.path, !file.viewed.viewed)
      .catch((error: unknown) => {
        dialog.error("Could not change the viewed mark", error);
      })
      .finally(() => {
        setViewedPending((current) => new Set([...current].filter((path) => path !== file.path)));
      });
  });
  return {
    drafts: remoteValue(drafts)?.drafts ?? [],
    filesFailure: firstPageFailure(files, retryFiles),
    filesPanelOpen,
    headContent,
    page,
    selected,
    source,
    target,
    toggleViewed,
    view,
    viewedPending,
  };
}
