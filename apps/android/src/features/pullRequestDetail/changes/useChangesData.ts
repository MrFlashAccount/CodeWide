import { useSelector } from "@legendapp/state/react";
import { useState } from "react";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import { remoteValue } from "../../../data/forgeRemoteValue";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { PullRequestChangesProps } from "./changesContract";
import type { PullRequestTarget } from "../workspaceCapabilities";

/** Files, drafts, the selected file and the viewed toggle of the Changes tab. */
export type ChangesData = {
  readonly drafts: readonly DraftComment[];
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
 * Demands the files page of the current head and the PR's drafts (both
 * progressive) and owns the viewed toggle. A viewed change is an explicit
 * forge write with its own pending state; a failure keeps the previous mark.
 */
export function useChangesData(props: PullRequestChangesProps): ChangesData {
  const { connectionId, forge, model, overview, review } = props;
  const dialog = useAppDialog();
  const target: PullRequestTarget = {
    connectionId,
    headRevision: overview.headRevision,
    pullRequest: overview.pullRequest,
  };
  const source = { kind: "pullRequest" as const, pullRequest: overview.pullRequest };
  forge.files.ensure(target);
  review.drafts.ensure({ connectionId, source });
  const files = useSelector(() => forge.files.state$[forge.files.keyOf(target)]?.get());
  const drafts = useSelector(() =>
    review.drafts.state$[review.drafts.keyOf({ connectionId, source })]?.get(),
  );
  const view = useSelector(() => model.changesView.get());
  const selectedPath = useSelector(() => model.selectedPath.get());
  const [viewedPending, setViewedPending] = useState<ReadonlySet<string>>(new Set());
  const page = remoteValue(files);
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
    page,
    selected: page?.files.find((file) => file.path === selectedPath) ?? page?.files[0] ?? null,
    source,
    target,
    toggleViewed,
    view,
    viewedPending,
  };
}
