import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type { CodeReviewLineReference } from "../comments/reviewComment";
import type { GuideLine } from "./CodeReviewGuide";

/** Guide visibility and the editor line it asked to show. */
export type GuideFocus = {
  readonly available: boolean;
  readonly comment: (line: GuideLine) => void;
  readonly focus: CodeReviewLineReference | null;
  readonly open: boolean;
  readonly reveal: (line: GuideLine) => void;
  readonly toggle: () => void;
};

/**
 * Connects a review's guide to its editor: Show selects the stop's file and
 * reveals its line; Comment opens that line's inline comment, which keeps the
 * review's existing composer delivery.
 */
export function useGuideFocus<Change extends { readonly path: string }>({
  available,
  changes,
  selectFile,
  selectLine,
}: {
  readonly available: boolean;
  readonly changes: readonly Change[];
  readonly selectFile: (change: Change) => void;
  readonly selectLine: (reference: CodeReviewLineReference) => void;
}): GuideFocus {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<CodeReviewLineReference | null>(null);
  const reveal = useEvent((line: GuideLine): void => {
    const change = changes.find((candidate) => candidate.path === line.path);
    if (change !== undefined) {
      selectFile(change);
    }
    setFocus({ coordinate: "file", line: line.line, path: line.path, side: "new" });
  });
  const comment = useEvent((line: GuideLine): void => {
    reveal(line);
    selectLine({ coordinate: "file", line: line.line, path: line.path, side: "new" });
  });
  const toggle = useEvent((): void => {
    setOpen((value) => !value);
  });
  return { available, comment, focus, open, reveal, toggle };
}
