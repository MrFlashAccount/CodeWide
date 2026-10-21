/**
 * Catalog filter state of the Pull requests list: the selected category and
 * repository. It is interaction state, held once for the process so returning
 * to the tab keeps the user's choice; it never mirrors resource data.
 */
import { observable } from "@legendapp/state";

import type { PullRequestCategory, PullRequestListPage } from "../../data/forgePullRequestContract";

/** Category and repository filter of the PR list. */
export type PullRequestListFilter = {
  readonly category: PullRequestCategory;
  readonly repository: string | null;
};

/** Process-lifetime filter owner; the default category is the one that asks for the user. */
export const pullRequestListModel = observable<PullRequestListFilter>({
  category: "reviewRequested",
  repository: null,
});

/** Whether the Accounts sheet is open; the catalog header and problem rows open it. */
export const forgeAccountsSheetOpen = observable(false);

/** Opens the Accounts sheet of the visible catalog. */
export function openForgeAccounts(): void {
  forgeAccountsSheetOpen.set(true);
}

/** Selects a category and keeps the repository filter. */
export function selectPullRequestCategory(category: PullRequestCategory): void {
  pullRequestListModel.category.set(category);
}

/** Selects one repository, or every repository with `null`. */
export function selectPullRequestRepository(repository: string | null): void {
  pullRequestListModel.repository.set(repository);
}

/**
 * The catalog bar's PR count: review-requested rows of connected accounts only, so
 * onboarding, an expired account or an older companion never show a count.
 */
export function reviewRequestedCount(page: PullRequestListPage | null): number {
  return (
    page?.sections.reduce(
      (total, section) => total + (section.account.state === "connected" ? section.rows.length : 0),
      0,
    ) ?? 0
  );
}
