import type { OverviewParams } from "../../data/forgeOverview";
import type { ForgeResources } from "../../data/forgeResources";
import type { ReviewResources } from "../../data/reviewResources";

/** The query owners a pull-to-refresh re-reads. */
type PullRequestRefreshOwners = {
  readonly forge: Pick<
    ForgeResources,
    "activity" | "conversation" | "files" | "overviews" | "scenarios"
  >;
  readonly review: Pick<ReviewResources, "drafts" | "guide">;
};

/**
 * Re-reads everything the PR screens show through the process-owned queries: the overview (status,
 * checks, merge state), activity, the conversation's first page, agent scenario states, the files
 * page at the shown head, drafts and the guide. Shown queries refetch in place and keep their
 * published data; the rest are marked stale and re-read when shown. Resolves once the shown
 * refetches settle; a failed read surfaces through its own query's error state, never here.
 */
export async function refreshPullRequest(
  owners: PullRequestRefreshOwners,
  target: OverviewParams & { readonly headRevision: string },
): Promise<void> {
  const params: OverviewParams = {
    connectionId: target.connectionId,
    pullRequest: target.pullRequest,
  };
  const review = {
    connectionId: target.connectionId,
    source: { kind: "pullRequest" as const, pullRequest: target.pullRequest },
  };
  await Promise.all([
    owners.forge.overviews.invalidate(params),
    owners.forge.activity.invalidate(params),
    owners.forge.conversation.invalidate(params),
    owners.forge.scenarios.invalidate(params),
    owners.forge.files.invalidate({ ...params, headRevision: target.headRevision }),
    owners.review.drafts.invalidate(review),
    owners.review.guide.invalidate(review),
  ]);
}
