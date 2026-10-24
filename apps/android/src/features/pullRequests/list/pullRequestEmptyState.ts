import type { PullRequestCategory } from "../../../data/forgePullRequestContract";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { activePullRequestFilterCount } from "../pullRequestListModel";

export type PullRequestEmptyStateCopy = {
  readonly description: string;
  readonly icon:
    | "at-outline"
    | "checkmark-done-outline"
    | "git-pull-request-outline"
    | "person-outline"
    | "search-outline";
  readonly title: string;
};

const CATEGORY_COPY: Readonly<Record<PullRequestCategory, PullRequestEmptyStateCopy>> = {
  all: {
    description: "Open pull requests from your connected accounts will appear here.",
    icon: "git-pull-request-outline",
    title: "No pull requests",
  },
  assigned: {
    description: "Pull requests assigned to you will appear here.",
    icon: "person-outline",
    title: "Nothing assigned",
  },
  authored: {
    description: "Pull requests you author will appear here.",
    icon: "git-pull-request-outline",
    title: "No open pull requests",
  },
  drafts: {
    description: "Draft pull requests from your connected accounts will appear here.",
    icon: "git-pull-request-outline",
    title: "No drafts",
  },
  involved: {
    description: "Pull requests involving you will appear here.",
    icon: "checkmark-done-outline",
    title: "You're all caught up",
  },
  mentioned: {
    description: "Pull requests that mention you will appear here.",
    icon: "at-outline",
    title: "No mentions",
  },
  reviewRequested: {
    description: "No pull requests are waiting for your review.",
    icon: "checkmark-done-outline",
    title: "All clear",
  },
};

/** Copy is derived from the applied query, never from transient loading state. */
export function pullRequestEmptyStateCopy(
  filter: PullRequestSearchFilter,
): PullRequestEmptyStateCopy {
  if (filter.query.text.trim().length > 0 || activePullRequestFilterCount(filter) > 0) {
    return {
      description: "Try another search or adjust your filters.",
      icon: "search-outline",
      title: "No matches",
    };
  }
  return CATEGORY_COPY[filter.query.category];
}
