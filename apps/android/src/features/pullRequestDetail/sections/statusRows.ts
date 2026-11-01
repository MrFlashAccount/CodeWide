/**
 * Which Status rows exist for a PR, in their fixed order: Issues and Reviews
 * from the loaded conversation, Checks and the merge state from the overview.
 */
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import {
  reviewsSummary,
  type Discussion,
  type StatusSummary,
} from "../conversation/discussionModel";
import { mergeBox, type MergeBoxRow } from "../overview/mergeBox";

/** The facts the Status section can show; `null` (or `false`) when the row is absent. */
export type StatusRows = {
  readonly checks: MergeBoxRow | null;
  readonly issues: StatusSummary | null;
  /** An open or draft PR shows its merge state; a merged or closed one does not. */
  readonly merge: boolean;
  readonly reviews: StatusSummary | null;
};

/** One Status row, named in display order. */
export type StatusRowName = "checks" | "issues" | "merge" | "reviews";

/** Projects the rows from the overview and, once loaded, the conversation. */
export function statusRows(
  overview: PullRequestOverview,
  discussion: Discussion | null,
): StatusRows {
  const box = mergeBox(overview);
  const open = box.kind === "open";
  return {
    checks: open ? box.checks : null,
    issues: discussion === null ? null : discussion.issueSummary,
    merge: open,
    reviews: discussion === null ? null : reviewsSummary(discussion.reviewers),
  };
}

/** The first present row in display order; it draws no divider. `null` hides the section. */
export function firstStatusRow(rows: StatusRows): StatusRowName | null {
  if (rows.issues !== null) {
    return "issues";
  }
  if (rows.reviews !== null) {
    return "reviews";
  }
  if (rows.checks !== null) {
    return "checks";
  }
  return rows.merge ? "merge" : null;
}
