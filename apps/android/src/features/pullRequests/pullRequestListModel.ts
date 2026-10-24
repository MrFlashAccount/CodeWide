/** Process-owned interaction model for the PR search header and filter tray. */
import { observable } from "@legendapp/state";

import type { PullRequestCategory, PullRequestListPage } from "../../data/forgePullRequestContract";
import {
  emptySearchValues,
  type PullRequestSearchFilter,
  type PullRequestSearchQuery,
  type SearchValues,
} from "../../data/forgePullRequestSearch";

export type PullRequestFilterFacet =
  | "sources"
  | "people"
  | "review"
  | "state"
  | "delivery"
  | "metadata"
  | "sort"
  | "advanced";

type FilterSheetState =
  | { readonly status: "closed" }
  | {
      readonly draft: PullRequestSearchFilter;
      readonly facet: PullRequestFilterFacet | null;
      readonly status: "open";
    };

type StoredFilterSheetState = {
  readonly draft: PullRequestSearchFilter | null;
  readonly facet: PullRequestFilterFacet | null;
  readonly status: "closed" | "open";
};

function defaultQuery(): PullRequestSearchQuery {
  return {
    assignees: emptySearchValues(),
    authors: emptySearchValues(),
    baseBranches: emptySearchValues(),
    category: "reviewRequested",
    checks: emptySearchValues(),
    headBranches: emptySearchValues(),
    labels: emptySearchValues(),
    repositories: emptySearchValues(),
    review: emptySearchValues(),
    reviewers: emptySearchValues(),
    sort: { direction: "descending", field: "updated" },
    states: { exclude: [], include: ["open"] },
    text: "",
  };
}

/** Default search is the review inbox: open PRs requesting the current user. */
export function defaultPullRequestFilter(): PullRequestSearchFilter {
  return { accounts: [], providerIds: [], query: defaultQuery() };
}

/** Process-lifetime applied filter; returning to the tab preserves it. */
export const pullRequestListModel = observable<PullRequestSearchFilter>(defaultPullRequestFilter());

const storedFilterSheetState = observable<StoredFilterSheetState>({
  draft: null,
  facet: null,
  status: "closed",
});

/** Read-only draft tray projection. Invalid stored combinations stay private. */
export const pullRequestFilterSheetModel = {
  get(): FilterSheetState {
    return projectFilterSheetState(storedFilterSheetState.get());
  },
  peek(): FilterSheetState {
    return projectFilterSheetState(storedFilterSheetState.peek());
  },
};

/** Whether the Accounts sheet is open; the catalog header and problem rows open it. */
export const forgeAccountsSheetOpen = observable(false);

/** Opens the Accounts sheet of the visible catalog. */
export function openForgeAccounts(): void {
  forgeAccountsSheetOpen.set(true);
}

/** Selects one quick view without changing the remaining applied filters. */
export function selectPullRequestCategory(category: PullRequestCategory): void {
  pullRequestListModel.query.category.set(category);
}

/** Applies the submitted free-text or qualifier query. */
export function selectPullRequestSearchText(text: string): void {
  pullRequestListModel.query.text.set(text.trim());
}

/** Opens a fresh draft copied from the applied filter. */
export function openPullRequestFilters(): void {
  storedFilterSheetState.set({
    draft: copyFilter(pullRequestListModel.peek()),
    facet: null,
    status: "open",
  });
}

/** Discards the draft and closes the tray. */
export function dismissPullRequestFilters(): void {
  storedFilterSheetState.set({ draft: null, facet: null, status: "closed" });
}

/** Shows one facet in the open draft. */
export function selectPullRequestFilterFacet(facet: PullRequestFilterFacet | null): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status === "open") {
    storedFilterSheetState.set({ ...state, facet });
  }
}

/** Replaces the open draft after one controlled edit. */
export function updatePullRequestFilterDraft(
  update: (draft: PullRequestSearchFilter) => PullRequestSearchFilter,
): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status === "open") {
    storedFilterSheetState.set({ ...state, draft: update(state.draft) });
  }
}

/** Publishes the complete draft in one store update. */
export function applyPullRequestFilters(): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status !== "open") {
    return;
  }
  pullRequestListModel.set(copyFilter(state.draft));
  storedFilterSheetState.set({ draft: null, facet: null, status: "closed" });
}

/** Resets the tray draft, not the visible list, until Apply. */
export function resetPullRequestFilterDraft(): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status === "open") {
    storedFilterSheetState.set({ ...state, draft: defaultPullRequestFilter() });
  }
}

function projectFilterSheetState(state: StoredFilterSheetState): FilterSheetState {
  if (state.status === "open" && state.draft !== null) {
    return { draft: state.draft, facet: state.facet, status: "open" };
  }
  return { status: "closed" };
}

/** Removes one applied filter chip immediately. */
export function clearAppliedPullRequestFilter(
  field:
    | keyof Pick<
        PullRequestSearchQuery,
        "authors" | "review" | "states" | "checks" | "repositories"
      >
    | "metadata"
    | "people"
    | "sources",
): void {
  if (field === "sources") {
    pullRequestListModel.assign({ accounts: [], providerIds: [] });
    return;
  }
  if (field === "people") {
    pullRequestListModel.query.authors.set(emptySearchValues());
    pullRequestListModel.query.assignees.set(emptySearchValues());
    pullRequestListModel.query.reviewers.set(emptySearchValues());
  } else if (field === "metadata") {
    pullRequestListModel.query.labels.set(emptySearchValues());
    pullRequestListModel.query.baseBranches.set(emptySearchValues());
    pullRequestListModel.query.headBranches.set(emptySearchValues());
  } else {
    switch (field) {
      case "authors":
        pullRequestListModel.query.authors.set(emptySearchValues());
        break;
      case "review":
        pullRequestListModel.query.review.set(emptySearchValues());
        break;
      case "states":
        pullRequestListModel.query.states.set({ exclude: [], include: ["open"] });
        break;
      case "checks":
        pullRequestListModel.query.checks.set(emptySearchValues());
        break;
      case "repositories":
        pullRequestListModel.query.repositories.set(emptySearchValues());
        break;
    }
  }
}

/** Number displayed on the filter button; quick view and default Open do not count. */
export function activePullRequestFilterCount(filter: PullRequestSearchFilter): number {
  const query = filter.query;
  return [
    filter.providerIds.length > 0 || filter.accounts.length > 0,
    hasValues(query.repositories),
    hasValues(query.authors) || hasValues(query.assignees) || hasValues(query.reviewers),
    hasValues(query.review),
    !isDefaultState(query.states),
    hasValues(query.checks),
    hasValues(query.labels) || hasValues(query.baseBranches) || hasValues(query.headBranches),
    query.sort.field !== "updated" || query.sort.direction !== "descending",
  ].filter(Boolean).length;
}

function hasValues<Value>(values: SearchValues<Value>): boolean {
  return values.include.length > 0 || values.exclude.length > 0;
}

function isDefaultState(values: PullRequestSearchQuery["states"]): boolean {
  return values.exclude.length === 0 && values.include.length === 1 && values.include[0] === "open";
}

function copyValues<Value>(values: SearchValues<Value>): SearchValues<Value> {
  return { exclude: [...values.exclude], include: [...values.include] };
}

function copyFilter(filter: PullRequestSearchFilter): PullRequestSearchFilter {
  const query = filter.query;
  return {
    accounts: [...filter.accounts],
    providerIds: [...filter.providerIds],
    query: {
      assignees: copyValues(query.assignees),
      authors: copyValues(query.authors),
      baseBranches: copyValues(query.baseBranches),
      category: query.category,
      checks: copyValues(query.checks),
      headBranches: copyValues(query.headBranches),
      labels: copyValues(query.labels),
      repositories: copyValues(query.repositories),
      review: copyValues(query.review),
      reviewers: copyValues(query.reviewers),
      sort: { direction: query.sort.direction, field: query.sort.field },
      states: copyValues(query.states),
      text: query.text,
    },
  };
}

/** Catalog bar count: review-requested rows of connected accounts only. */
export function reviewRequestedCount(page: PullRequestListPage | null): number {
  return (
    page?.sections.reduce(
      (total, section) => total + (section.account.state === "connected" ? section.rows.length : 0),
      0,
    ) ?? 0
  );
}
