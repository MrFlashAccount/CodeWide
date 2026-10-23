import type { PullRequestKey } from "./forgeContract";

/** Identity of one pull request overview on one Companion connection. */
export type OverviewParams = {
  readonly connectionId: string;
  readonly pullRequest: PullRequestKey;
};
