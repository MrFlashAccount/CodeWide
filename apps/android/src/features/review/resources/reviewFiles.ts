import type { ThreadChangeResource } from "../../../data/workspace-resource-database";

export type CodeReviewFileResource = ThreadChangeResource & {
  /** A regular remote file opened in the review workspace, not a recorded diff. */
  sourceOnly?: boolean;
};

export function codeReviewFilesForDocument(
  changes: readonly ThreadChangeResource[],
  path: string,
): CodeReviewFileResource[] {
  if (changes.some((change) => change.path === path)) {
    return [...changes];
  }
  return [
    ...changes,
    {
      additions: 0,
      availability: "available",
      deletions: 0,
      itemId: path,
      kind: "update",
      path,
      sourceOnly: true,
      turnId: "attached-file",
    },
  ];
}
