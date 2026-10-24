import type { PullRequestKey } from "../../data/forgeContract";
import type { ForgeResources } from "../../data/forgeResources";
import type { PullRequestCommentDestinations } from "../../data/pullRequestCommentDestinations";
import type { ThreadId } from "../../data/reviewContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { ReviewTargetCapabilities } from "../review/reviewTargetCapabilities";
import type { LinkedThreadDescription } from "./linkedThreadDescription";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";

/** Route intents the PR screen raises; route composition owns navigation. */
type PullRequestScreenNavigation = {
  readonly back: () => void;
  /** Starts rendering the chat destination before its canonical id resolves. */
  readonly beginChat: () => void;
  readonly chatVisible: boolean;
  readonly closeChat: () => void;
  readonly openPullRequestFullscreen: () => void;
  readonly openThread: (threadId: ThreadId) => void;
  readonly pullRequestFullscreen: boolean;
};

/** Stable owners and intents route composition passes to the PR screen. */
export type PullRequestScreenProps = {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly commentDestinations: PullRequestCommentDestinations;
  readonly connectionId: string;
  readonly describeThread: (threadId: ThreadId) => LinkedThreadDescription | null;
  readonly forge: ForgeResources;
  readonly navigation: PullRequestScreenNavigation;
  readonly pullRequest: PullRequestKey;
  readonly review: Pick<ReviewResources, "drafts" | "guide">;
  readonly reviewCapabilities: ReviewTargetCapabilities;
  readonly tablet: boolean;
};
