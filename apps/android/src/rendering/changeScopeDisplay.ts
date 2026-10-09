import type { ThreadChangeScope, ThreadChangesVcsContext } from "../data/thread-resource-types";
import { changeScopeTitle } from "./change-menu";

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
    title: branchScope ? (vcs?.branch ?? "Branch") : changeScopeTitle(scope),
  };
}
