import { use, useEffect } from "react";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DiffContent } from "./changesPresentation";
import type { HeadFileSource, HeadFileViews } from "./headFileViews";

const PENDING: DiffContent = { state: "pending" };

/**
 * What the diff of `file` shows, decided once per view by `views`. While the
 * whole head file is still being read this suspends the render, so a deferred
 * selection keeps the previous file on screen and the editor receives only
 * the final document. `file: null` is the not-yet-deferred first render, which
 * shows the editor's own loading state.
 */
export function useHeadFileContent({
  file,
  files,
  source,
  views,
}: {
  readonly file: PullRequestFile | null;
  readonly files: readonly PullRequestFile[];
  readonly source: HeadFileSource;
  readonly views: HeadFileViews;
}): DiffContent {
  const key = file === null ? null : views.keyOf(source, file);
  // Retention only: the shown view's decision outlives revisits of other files.
  useEffect(() => {
    if (key !== null) {
      views.retainOnly(key);
    }
  }, [key, views]);
  if (file === null) {
    return PENDING;
  }
  const decision = views.decide(source, files, file);
  return decision.status === "settled" ? decision.content : use(decision.promise);
}
