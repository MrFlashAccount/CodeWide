/** Process-owned interaction model for the PR search header and filter tray. */
import { observable } from "@legendapp/state";

import type { PullRequestCategory } from "../../data/forgePullRequestContract";
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

/** Free-text query fields the tray edits as removable tokens. */
export type PullRequestTermField =
  | "assignees"
  | "authors"
  | "baseBranches"
  | "headBranches"
  | "labels"
  | "reviewers";

type PullRequestTermDrafts = Readonly<Record<PullRequestTermField, string>>;

const TERM_FIELDS: readonly PullRequestTermField[] = [
  "assignees",
  "authors",
  "baseBranches",
  "headBranches",
  "labels",
  "reviewers",
];
const TERM_SEPARATOR = /[,\n]/u;

type FilterSheetState =
  | {
      readonly retained: {
        readonly draft: PullRequestSearchFilter;
        readonly facet: PullRequestFilterFacet | null;
      } | null;
      readonly session: number;
      readonly status: "closed";
    }
  | {
      readonly draft: PullRequestSearchFilter;
      readonly facet: PullRequestFilterFacet | null;
      readonly session: number;
      readonly status: "open";
    };

type StoredFilterSheetState = {
  readonly draft: PullRequestSearchFilter | null;
  readonly facet: PullRequestFilterFacet | null;
  readonly session: number;
  readonly status: "closed" | "open";
};

function defaultQuery(): PullRequestSearchQuery {
  return {
    assignees: emptySearchValues(),
    authors: emptySearchValues(),
    baseBranches: emptySearchValues(),
    category: "involved",
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
/** Default search is open PRs involving the connected account. */
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
  session: 0,
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

/**
 * Text typed into each token field of the open tray but not yet turned into a
 * token. It belongs to the tray draft: Apply commits it, and opening or
 * resetting the tray clears it. It is kept apart from the draft so a
 * keystroke rerenders only the field that shows it.
 */
const termDraftModel = observable<PullRequestTermDrafts>(emptyTermDrafts());

/** Pending text of one token field of the open tray; read inside `useSelector`. */
export function pullRequestTermText(field: PullRequestTermField): string {
  return termDraftModel[field].get();
}

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

/** Applies one list category independently from search, sort and the tray draft. */
export function selectPullRequestCategory(category: PullRequestCategory): void {
  publishAppliedQuery((query) => (query.category === category ? query : { ...query, category }));
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
  const previous = storedFilterSheetState.peek();
  termDraftModel.set(emptyTermDrafts());
  storedFilterSheetState.set({
    draft: copyFilter(pullRequestListModel.peek()),
    facet: null,
    session: previous.session + 1,
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

/**
 * Replaces one token field's pending text. A comma or line break completes
 * every value before it as a token; the remainder stays editable.
 */
export function updatePullRequestTermText(field: PullRequestTermField, text: string): void {
  const parts = text.split(TERM_SEPARATOR);
  const pending = parts.pop() ?? "";
  addPullRequestTerms(field, parts);
  setTermText(field, pending);
}

/** Turns one token field's pending text into tokens, as Enter does. */
export function commitPullRequestTermText(field: PullRequestTermField): void {
  addPullRequestTerms(field, termDraftModel[field].peek().split(TERM_SEPARATOR));
  setTermText(field, "");
}

/** Adds included tokens to the open draft; a value that was excluded becomes included. */
export function addPullRequestTerms(field: PullRequestTermField, values: readonly string[]): void {
  const terms = normalizedTerms(values);
  if (terms.length > 0) {
    updatePullRequestFilterDraft((draft) => withTerms(draft, field, terms));
  }
}

/** Removes one token, whether it includes or excludes the value. */
export function removePullRequestTerm(field: PullRequestTermField, value: string): void {
  updatePullRequestFilterDraft((draft) => {
    const values = draft.query[field];
    return {
      ...draft,
      query: {
        ...draft.query,
        [field]: {
          exclude: values.exclude.filter((candidate) => candidate !== value),
          include: values.include.filter((candidate) => candidate !== value),
        },
      },
    };
  });
}

/** Publishes the complete draft, including pending token text, in one store update. */
export function applyPullRequestFilters(): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status !== "open") {
    return;
  }
  const pending = termDraftModel.peek();
  const draft = copyFilter(
    TERM_FIELDS.reduce(
      (current, field) =>
        withTerms(current, field, normalizedTerms(pending[field].split(TERM_SEPARATOR))),
      state.draft,
    ),
  );
  const applied = pullRequestListModel.peek().query;
  termDraftModel.set(emptyTermDrafts());
  // The tray owns structured conditions only; category, search and sort stay as applied.
  pullRequestListModel.set({
    ...draft,
    query: { ...draft.query, category: applied.category, sort: applied.sort, text: applied.text },
  });
  // Keep the committed snapshot rendered until Tray finishes its native-thread exit animation.
  storedFilterSheetState.set({ ...state, draft, status: "closed" });
}

/** Resets the tray draft, not the visible list, until Apply. */
export function resetPullRequestFilterDraft(): void {
  const state = pullRequestFilterSheetModel.peek();
  if (state.status === "open") {
    termDraftModel.set(emptyTermDrafts());
    storedFilterSheetState.set({ ...state, draft: withoutStructuredFilters(state.draft) });
  }
}

function setTermText(field: PullRequestTermField, text: string): void {
  const open = pullRequestFilterSheetModel.peek().status === "open";
  if (open && termDraftModel[field].peek() !== text) {
    termDraftModel[field].set(text);
  }
}

function emptyTermDrafts(): PullRequestTermDrafts {
  return {
    assignees: "",
    authors: "",
    baseBranches: "",
    headBranches: "",
    labels: "",
    reviewers: "",
  };
}

function normalizedTerms(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function withTerms(
  draft: PullRequestSearchFilter,
  field: PullRequestTermField,
  terms: readonly string[],
): PullRequestSearchFilter {
  if (terms.length === 0) {
    return draft;
  }
  const values = draft.query[field];
  return {
    ...draft,
    query: {
      ...draft.query,
      [field]: {
        exclude: values.exclude.filter((value) => !terms.includes(value)),
        include: [...values.include, ...terms.filter((term) => !values.include.includes(term))],
      },
    },
  };
}

function projectFilterSheetState(state: StoredFilterSheetState): FilterSheetState {
  if (state.status === "open" && state.draft !== null) {
    return { draft: state.draft, facet: state.facet, session: state.session, status: "open" };
  }
  return {
    retained: state.draft === null ? null : { draft: state.draft, facet: state.facet },
    session: state.session,
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
