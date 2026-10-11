import type { ThreadChangeScope, ThreadChangesVcsContext } from "../data/thread-resource-types";
import { changeScopeTitle } from "./change-menu";

const BRANCH_TITLE_OVERFLOW_PATTERN = /^(.{32}).{2,}(.{31})$/su;

/** Presents the selected scope using only the VCS identity of its changes snapshot. */
export function changeScopeDisplay(
  scope: ThreadChangeScope,
  vcs: ThreadChangesVcsContext | undefined,
): {
  readonly icon: "git-branch-outline" | "git-compare-outline";
  readonly title: string;
} {
  const branchScope = scope === "branch";
  return {
    icon: branchScope ? "git-branch-outline" : "git-compare-outline",
    title: branchScope ? boundedBranchTitle(vcs?.branch) : changeScopeTitle(scope),
  };
}

/** Keeps both identifying ends of a long branch without widening every Changes chip. */
function boundedBranchTitle(branch: string | null | undefined): string {
  return (branch ?? "Branch").replace(BRANCH_TITLE_OVERFLOW_PATTERN, "$1…$2");
}
