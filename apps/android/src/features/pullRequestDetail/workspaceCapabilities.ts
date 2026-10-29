import type { ConfirmLevel } from "../../data/forgeActionCatalog";
import type { AttentionRevision, HeadRevision, PullRequestKey } from "../../data/forgeContract";
import type { ConversationComment, ReviewThreadId } from "../../data/forgeConversationContract";
import type {
  ActionRunResult,
  ReviewChatOpening,
  ScenarioStartOutcome,
  SubmitOutcome,
  ViewedMark,
} from "../../data/forgeMutationContract";
import type { LinkedThread } from "../../data/forgePullRequestContract";
import type { TransferAccess } from "../../data/private-transfer";
import type { DraftId, ThreadId } from "../../data/reviewContract";

/** Agent scenario kinds; `message` is the Overview dock. */
export type ScenarioKind = "addressComments" | "fixCi" | "message" | "rebase" | "reviewPr";

/**
 * Where a missing review chat may be created: `ask` lets the Companion answer
 * `needsWorkspace` instead of choosing a directory; `path` is the user's confirmed choice,
 * admitted by the Companion. A live canonical chat is returned either way.
 */
export type ReviewChatWorkspace =
  | { readonly kind: "ask" }
  | { readonly kind: "path"; readonly path: string };

/**
 * Where a scenario continues: always the PR's canonical review chat, the same thread
 * `ensureReviewChat` opens. The companion resolves, creates and records it.
 */
type ScenarioTarget = {
  readonly kind: "reviewChat";
  readonly workspace: ReviewChatWorkspace;
};

/** PR identity carried by every PR mutation. */
export type PullRequestTarget = {
  readonly connectionId: string;
  readonly headRevision: HeadRevision;
  readonly pullRequest: PullRequestKey;
};

/**
 * Forge writes and agent starts of the PR screen. Each forge write has one
 * trigger and is acknowledged by the companion; diff-bound writes carry the head revision;
 * replay-safe writes enter the persisted TanStack mutation queue before their
 * first RPC. Each idempotency key is generated per user tap and survives replay.
 */
export type PullRequestDetailWorkspaceCapabilities = {
  /** Publishes one top-level conversation comment immediately (`forge.comments@1`). */
  readonly createComment: (
    target: Omit<PullRequestTarget, "headRevision">,
    request: { readonly body: string; readonly idempotencyKey: string },
  ) => Promise<ConversationComment>;
  readonly ensureReviewChat: (
    target: Omit<PullRequestTarget, "headRevision">,
    workspace: ReviewChatWorkspace,
  ) => Promise<ReviewChatOpening>;
  readonly markAttentionSeen: (target: {
    readonly connectionId: string;
    readonly pullRequest: PullRequestKey;
    readonly revision: AttentionRevision;
  }) => Promise<void>;
  /** Publishes one reply in a review thread immediately (`forge.comments@1`). */
  readonly replyToReviewThread: (
    target: Omit<PullRequestTarget, "headRevision">,
    request: {
      readonly body: string;
      readonly idempotencyKey: string;
      readonly threadId: ReviewThreadId;
    },
  ) => Promise<ConversationComment>;
  readonly runAction: (
    target: PullRequestTarget,
    request: {
      readonly actionId: string;
      readonly confirmation: ConfirmLevel;
      readonly idempotencyKey: string;
      readonly input: boolean | string | null;
    },
  ) => Promise<ActionRunResult>;
  readonly setLink: (
    target: Omit<PullRequestTarget, "headRevision">,
    threadId: ThreadId,
    linked: boolean,
  ) => Promise<readonly LinkedThread[]>;
  readonly setViewed: (
    target: PullRequestTarget,
    path: string,
    viewed: boolean,
  ) => Promise<ViewedMark>;
  readonly startScenario: (
    target: PullRequestTarget,
    request: {
      readonly checkId: string | null;
      readonly idempotencyKey: string;
      /** Focuses `addressComments` on one review thread; `null` addresses the whole PR. */
      readonly reviewThreadId: ReviewThreadId | null;
      readonly scenario: ScenarioKind;
      readonly target: ScenarioTarget;
      readonly text: string | null;
    },
  ) => Promise<ScenarioStartOutcome>;
  readonly submitReview: (
    target: PullRequestTarget,
    request: {
      readonly body: string | null;
      readonly draftIds: readonly DraftId[];
      readonly forwardBothToAgent: boolean;
      readonly idempotencyKey: string;
      readonly verdictActionId: string;
    },
  ) => Promise<SubmitOutcome>;
  /** Companion media access for private and forge-hosted images on the PR screen. */
  readonly transferAccess: (connectionId: string, forceRefresh: boolean) => Promise<TransferAccess>;
};
