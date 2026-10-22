import type { Observable } from "@legendapp/state";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import type { ForgeResources } from "../../../data/forgeResources";
import type { PullRequestCommentDestinations } from "../../../data/pullRequestCommentDestinations";
import type { ThreadId } from "../../../data/reviewContract";
import type { ReviewResources } from "../../../data/reviewResources";
import type { ReviewTargetCapabilities } from "../../review/reviewTargetCapabilities";
import type { PullRequestScreenState } from "../pullRequestScreenModel";
import type { PullRequestDetailWorkspaceCapabilities } from "../workspaceCapabilities";

/** Everything the Changes tab needs from its screen. */
export type PullRequestChangesProps = {
  readonly agentThread: { readonly threadId: ThreadId; readonly title: string } | null;
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  /** Last comment destination per PR on this device. */
  readonly commentDestinations: PullRequestCommentDestinations;
  readonly connectionId: string;
  readonly describeThread: (threadId: ThreadId) => string;
  readonly fileActions: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly forge: Pick<ForgeResources, "files" | "loadMoreFiles">;
  readonly host: string;
  readonly model: Observable<PullRequestScreenState>;
  readonly nowMs: number;
  readonly offline: boolean;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly onStale: (kind: "outcomeUnknown" | "stale") => void;
  readonly overview: PullRequestOverview;
  readonly ownPullRequest: boolean;
  readonly review: Pick<ReviewResources, "drafts" | "guide">;
  readonly reviewCapabilities: ReviewTargetCapabilities;
  readonly tablet: boolean;
  readonly verdicts: readonly ActionDescriptor[];
};
