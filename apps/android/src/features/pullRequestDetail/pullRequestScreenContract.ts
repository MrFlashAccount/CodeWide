import type { PullRequestKey } from "../../data/forgeContract";
import type { ReviewChatWorkspaceCandidate } from "../../data/forgeMutationContract";
import type { ForgeResources } from "../../data/forgeResources";
import type { ThreadUnreadReader } from "../../data/project-unread-model";
import type { PullRequestCommentDestinations } from "../../data/pullRequestCommentDestinations";
import type { ThreadId } from "../../data/reviewContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { ReviewTargetCapabilities } from "../review/reviewTargetCapabilities";
import type { LinkedThreadDescription } from "./linkedThreadDescription";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";
import type { ChangesView, PullRequestTab } from "./pullRequestScreenModel";

/**
 * Holds an agent scenario whose review chat does not exist yet. Route composition opens the
 * review-chat draft with the scenario pending: the first candidate is pre-selected (none without
 * one) and `start` runs with the project the user confirms there; a failure stays in the draft.
 * Settles with the started thread, or `null` when the draft is dismissed or replaced.
 */
export type DeferReviewChatScenario = (scenario: {
  readonly candidates: readonly ReviewChatWorkspaceCandidate[];
  /** The scenario's action label, such as `Review PR`. */
  readonly label: string;
  readonly start: (path: string) => Promise<ThreadId>;
}) => Promise<ThreadId | null>;

/** Route intents the PR screen raises; route composition owns navigation. */
type PullRequestScreenNavigation = {
  readonly back: () => void;
  readonly chatVisible: boolean;
  /** Leaves Changes for the Details screen beneath it. */
  readonly closeChanges: () => void;
  readonly deferReviewChatScenario: DeferReviewChatScenario;
  /** Pushes the Changes route over Details, opening the files or the guide. */
  readonly openChanges: (view: ChangesView) => void;
  /** Toggles the PR pane alone; `null` where its pane cannot be shown alone. */
  readonly openPullRequestFullscreen: (() => void) | null;
  /**
   * Presents the PR's review chat: the canonical thread the overview names opens directly;
   * without one, the route opens the review-chat draft at once.
   */
  readonly openReviewChat: (reviewThread: ThreadId | null) => void;
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
  /** What Changes shows first; Details ignores it. */
  readonly initialChangesView: ChangesView;
  /** Unread state of the connection's chats, owned by the thread catalog. */
  readonly isThreadUnread: ThreadUnreadReader;
  readonly navigation: PullRequestScreenNavigation;
  readonly pullRequest: PullRequestKey;
  readonly review: Pick<ReviewResources, "drafts" | "guide">;
  readonly reviewCapabilities: ReviewTargetCapabilities;
  readonly tab: PullRequestTab;
  readonly tablet: boolean;
};
