/** Process-owned interaction model for the PR search header and filter tray. */
import { observable } from "@legendapp/state";

import type { PullRequestListPage } from "../../data/forgePullRequestContract";
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
  | "metadata";

type FilterSheetState =
  | {
      readonly retained: {
        readonly draft: PullRequestSearchFilter;
        readonly facet: PullRequestFilterFacet | null;
      } | null;
      readonly status: "closed";
    }
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
    category: "all",
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

/** Default search is every open PR across the selected sources. */
export function defaultPullRequestFilter(): PullRequestSearchFilter {
  return { accounts: [], providerIds: [], query: defaultQuery() };
}

/** Process-lifetime applied filter; returning to the tab preserves it. */
export const pullRequestListModel = observable<PullRequestSearchFilter>(defaultPullRequestFilter());

/** Search expansion and editable text are independent from applied list filters. */
export const pullRequestSearchModel = observable({ draft: "", open: false });

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

/** Applies the submitted free-text or qualifier query. */
export function selectPullRequestSearchText(text: string): void {
  const normalized = text.trim();
  publishAppliedQuery((query) =>
    query.text === normalized ? query : { ...query, text: normalized },
  );
}

/** Opens the shared catalog search surface from tap or pull. */
export function openPullRequestSearch(): void {
  pullRequestSearchModel.set({ draft: pullRequestListModel.peek().query.text, open: true });
}

/** Leaves the applied search intact. */
export function closePullRequestSearch(): void {
  const state = pullRequestSearchModel.peek();
  if (state.open) {
    pullRequestSearchModel.set({ ...state, open: false });
  }
}

/** Updates only the retained search editor. */
export function updatePullRequestSearchDraft(draft: string): void {
  const state = pullRequestSearchModel.peek();
  if (state.draft !== draft) {
    pullRequestSearchModel.set({ ...state, draft });
  }
}

/** Applies sorting independently from structured filters. */
export function selectPullRequestSort(sort: PullRequestSearchQuery["sort"]): void {
  publishAppliedQuery((query) =>
    query.sort.field === sort.field && query.sort.direction === sort.direction
      ? query
      : { ...query, sort },
  );
}

/** Opens a fresh draft copied from the applied filter. */
export function openPullRequestFilters(): void {
  storedFilterSheetState.set({
    draft: copyFilter(pullRequestListModel.peek()),
    facet: null,
    status: "open",
  });
}

/** Closes without applying; the inaccessible draft survives only for the tray's exit frame. */
export function dismissPullRequestFilters(): void {
  const state = storedFilterSheetState.peek();
  storedFilterSheetState.set({ ...state, status: "closed" });
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
  // Keep the rendered snapshot until Tray finishes its native-thread exit animation.
  storedFilterSheetState.set({ ...state, status: "closed" });
}

/** Resets the tray draft, not the visible list, until Apply. */
export function resetPullRequestFilterDraft(): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status === "open") {
    storedFilterSheetState.set({ ...state, draft: withoutStructuredFilters(state.draft) });
  }
}

function projectFilterSheetState(state: StoredFilterSheetState): FilterSheetState {
  if (state.status === "open" && state.draft !== null) {
    return { draft: state.draft, facet: state.facet, status: "open" };
  }
  return {
    retained: state.draft === null ? null : { draft: state.draft, facet: state.facet },
    status: "closed",
  };
}

/**
 * Publishes a new immutable query snapshot. Query-cache keys retain old
 * filter objects, so mutating a nested Legend node would corrupt identities of
 * both the current and previously cached requests.
 */
function publishAppliedQuery(
  update: (query: PullRequestSearchQuery) => PullRequestSearchQuery,
): void {
  const current = pullRequestListModel.peek();
  const query = update(current.query);
  if (query !== current.query) {
    pullRequestListModel.set({ ...current, query });
  }
}

/** Number displayed on the filter button; search, sort and default Open do not count. */
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
  ].filter(Boolean).length;
}

function withoutStructuredFilters(filter: PullRequestSearchFilter): PullRequestSearchFilter {
  return {
    accounts: [],
    providerIds: [],
    query: {
      ...filter.query,
      assignees: emptySearchValues(),
      authors: emptySearchValues(),
      baseBranches: emptySearchValues(),
      checks: emptySearchValues(),
      headBranches: emptySearchValues(),
      labels: emptySearchValues(),
      repositories: emptySearchValues(),
      review: emptySearchValues(),
      reviewers: emptySearchValues(),
      states: { exclude: [], include: ["open"] },
    },
  };
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
