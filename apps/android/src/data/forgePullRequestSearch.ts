/**
 * Provider-neutral outgoing contract of `companion/pullRequests/search`.
 * Values within a field are ORed; fields are ANDed. A provider must apply the
 * complete query or reject it.
 */
import type { ForgeAccountKey } from "./forgeContract";
import type { PullRequestCategory } from "./forgePullRequestContract";

export type SearchValues<Value> = {
  readonly exclude: readonly Value[];
  readonly include: readonly Value[];
};

export type PullRequestSearchQuery = {
  readonly assignees: SearchValues<string>;
  readonly authors: SearchValues<string>;
  readonly baseBranches: SearchValues<string>;
  readonly category: PullRequestCategory;
  readonly checks: SearchValues<"failing" | "none" | "passing" | "pending">;
  readonly headBranches: SearchValues<string>;
  readonly labels: SearchValues<string>;
  readonly repositories: SearchValues<string>;
  readonly review: SearchValues<"approved" | "changesRequested" | "none" | "required">;
  readonly reviewers: SearchValues<string>;
  readonly sort: {
    readonly direction: "ascending" | "descending";
    readonly field: "created" | "updated";
  };
  readonly states: SearchValues<"closed" | "draft" | "merged" | "open">;
  readonly text: string;
};

/** Source scope plus the query applied inside every selected source. */
export type PullRequestSearchFilter = {
  readonly accounts: readonly ForgeAccountKey[];
  readonly providerIds: readonly string[];
  readonly query: PullRequestSearchQuery;
};

/** Creates an empty value set without sharing mutable array identity. */
export function emptySearchValues<Value>(): SearchValues<Value> {
  return { exclude: [], include: [] };
}
